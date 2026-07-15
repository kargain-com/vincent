import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { config as loadEnv } from 'dotenv';

import { createAnchorReader } from '@kargain/vincent/anchor';
import { addressFromPrivateKey, toChecksumAddress } from '@kargain/vincent/protocol';
import { formatEther } from 'viem';

import { createIrysUploader } from '../adapters/irys-uploader.js';
import { createRegistryPublisher } from '../adapters/registry-publisher.js';
import { sha256ContentIdToBytes32 } from '../adapters/sha256-bytes32.js';
import { fetchBaseEpoch } from '../fetch-base-epoch.js';
import {
  DEFAULT_COMMUNITY_CHECKPOINT_PATH,
  publishCommunityEpoch,
} from '../community-epoch.js';
import {
  DEFAULT_FULL_INDEX_CHECK_LOG_INTERVAL,
  DEFAULT_FULL_UPLOAD_CONCURRENCY,
  IRYS_GRAPHQL_URL,
} from '../constants.js';
import type { PublishEpochProgress } from '../publish-epoch.js';
import type { UploadBudgetQuote } from '../estimate-epoch-upload-cost.js';
import {
  resolveIndexCheckDefaults,
  resolveIrysGatewayUrl,
  resolvePublishNetwork,
  type PublishNetworkId,
} from '../publish-network.js';
import { assertIrysGraphqlUrl, assertJsonRpcUrl } from '../validate-env-urls.js';
import { parseNetworkFlags } from './parse-network-flags.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const PUBLISH_ROOT = join(__dirname, '../..');

loadEnv({ path: join(PUBLISH_ROOT, '.env') });

const USAGE =
  'Usage: publish-community --network base-sepolia|base ' +
  '--claims <accepted-community-claims.jsonl> --archive <attestation-archive.json> ' +
  '--base <publisher>:<index> [--jitter-days <n>] [--force] ' +
  '[--upload-only|--anchor-only|--retry-failed] [--checkpoint-file <path>]';

/** Publish leaves in "large epoch" mode above this claim count. */
const LARGE_EPOCH_CLAIM_THRESHOLD = 1000;

interface CliOptions {
  network: PublishNetworkId;
  claimsPath: string;
  archivePath: string;
  basePublisher: string;
  baseIndex: number;
  jitterDays?: number;
  force: boolean;
  uploadOnly: boolean;
  anchorOnly: boolean;
  retryFailed: boolean;
  allowReupload: boolean;
  maxReuploadLeaves?: number;
  uploadConcurrency?: number;
  indexCheckConcurrency?: number;
  indexCheckDelayMs?: number;
  indexCheckTimeoutMs?: number;
  checkpointFile: string;
}

function flagValue(argv: string[], name: string): string | undefined {
  const assigned = argv.find((arg) => arg.startsWith(`${name}=`));
  if (assigned !== undefined) {
    return assigned.slice(name.length + 1);
  }
  const index = argv.indexOf(name);
  if (index >= 0) {
    return argv[index + 1];
  }
  return undefined;
}

function requiredFlag(argv: string[], name: string): string {
  const value = flagValue(argv, name);
  if (value === undefined || value.length === 0 || value.startsWith('--')) {
    throw new Error(`${name} is required. ${USAGE}`);
  }
  return value;
}

function positiveIntFlag(argv: string[], name: string): number | undefined {
  const raw = flagValue(argv, name);
  if (raw === undefined) return undefined;
  const value = Number(raw);
  if (!Number.isInteger(value) || value < 1) {
    throw new Error(`${name} must be a positive integer`);
  }
  return value;
}

function nonNegativeIntFlag(argv: string[], name: string): number | undefined {
  const raw = flagValue(argv, name);
  if (raw === undefined) return undefined;
  const value = Number(raw);
  if (!Number.isInteger(value) || value < 0) {
    throw new Error(`${name} must be a non-negative integer`);
  }
  return value;
}

function parseBaseFlag(raw: string): { publisher: string; index: number } {
  const separator = raw.lastIndexOf(':');
  if (separator <= 0) {
    throw new Error('--base must be <publisher>:<index> (on-chain 0-based epoch index)');
  }
  const publisher = raw.slice(0, separator);
  const index = Number(raw.slice(separator + 1));
  if (!/^0x[0-9a-fA-F]{40}$/.test(publisher)) {
    throw new Error('--base publisher must be a 0x-prefixed address');
  }
  if (!Number.isInteger(index) || index < 0) {
    throw new Error('--base index must be a non-negative integer');
  }
  return { publisher: toChecksumAddress(publisher), index };
}

function parseArgs(argv: string[]): CliOptions {
  const network = parseNetworkFlags(argv);
  const claimsPath = requiredFlag(argv, '--claims');
  const archivePath = requiredFlag(argv, '--archive');
  const base = parseBaseFlag(requiredFlag(argv, '--base'));

  const jitterRaw = flagValue(argv, '--jitter-days');
  let jitterDays: number | undefined;
  if (jitterRaw !== undefined) {
    jitterDays = Number(jitterRaw);
    if (!Number.isFinite(jitterDays) || jitterDays < 0) {
      throw new Error('--jitter-days must be a non-negative number');
    }
  }

  const uploadOnly = argv.includes('--upload-only');
  const anchorOnly = argv.includes('--anchor-only');
  const retryFailed = argv.includes('--retry-failed');
  if (uploadOnly && anchorOnly) {
    throw new Error('--upload-only and --anchor-only are mutually exclusive');
  }
  if (retryFailed && anchorOnly) {
    throw new Error('--retry-failed and --anchor-only are mutually exclusive');
  }

  return {
    network,
    claimsPath,
    archivePath,
    basePublisher: base.publisher,
    baseIndex: base.index,
    jitterDays,
    force: argv.includes('--force'),
    uploadOnly,
    anchorOnly,
    retryFailed,
    allowReupload: argv.includes('--allow-reupload'),
    maxReuploadLeaves: nonNegativeIntFlag(argv, '--max-reupload-leaves'),
    uploadConcurrency: positiveIntFlag(argv, '--upload-concurrency'),
    indexCheckConcurrency: positiveIntFlag(argv, '--index-check-concurrency'),
    indexCheckDelayMs: nonNegativeIntFlag(argv, '--index-check-delay'),
    indexCheckTimeoutMs: positiveIntFlag(argv, '--index-check-timeout'),
    checkpointFile:
      flagValue(argv, '--checkpoint-file') ??
      join(PUBLISH_ROOT, DEFAULT_COMMUNITY_CHECKPOINT_PATH),
  };
}

function requireEnv(name: string): string {
  const value = process.env[name];
  if (value === undefined || value.length === 0) {
    throw new Error(`Missing required env var: ${name}`);
  }
  return value;
}

function optionalEnv(name: string, fallback: string): string {
  const value = process.env[name];
  return value === undefined || value.length === 0 ? fallback : value;
}

function normalizePrivateKey(value: string): `0x${string}` {
  return (value.startsWith('0x') ? value : `0x${value}`) as `0x${string}`;
}

function formatProgressPercent(completed: number, total: number): string {
  if (total <= 0) {
    return '0%';
  }
  return `${((completed / total) * 100).toFixed(1)}%`;
}

function createProgressLogger(leafLogInterval: number, indexCheckLogInterval: number) {
  let lastLeafLogAt = 0;
  let lastIndexLogAt = 0;

  return (progress: PublishEpochProgress): void => {
    switch (progress.phase) {
      case 'leaves': {
        const shouldLog =
          progress.completed === 0 ||
          progress.completed === progress.total ||
          progress.completed - lastLeafLogAt >= leafLogInterval;
        if (!shouldLog) return;
        lastLeafLogAt = progress.completed;
        process.stdout.write(
          `Uploading leaves ${String(progress.completed)}/${String(progress.total)} ` +
            `(${formatProgressPercent(progress.completed, progress.total)})...\n`,
        );
        return;
      }
      case 'jsonl':
        if (progress.completed === 0) process.stdout.write('Uploading JSONL...\n');
        return;
      case 'manifest':
        if (progress.completed === 0) process.stdout.write('Uploading manifest...\n');
        return;
      case 'index-check': {
        const shouldLog =
          progress.completed === 0 ||
          progress.completed === progress.total ||
          progress.completed - lastIndexLogAt >= indexCheckLogInterval;
        if (!shouldLog) return;
        lastIndexLogAt = progress.completed;
        process.stdout.write(
          `Verifying index ${String(progress.completed)}/${String(progress.total)} ` +
            `(${formatProgressPercent(progress.completed, progress.total)})...\n`,
        );
        return;
      }
      case 'anchor':
        if (progress.completed === 0) process.stdout.write('Anchoring on chain...\n');
        return;
      default:
        return;
    }
  };
}

async function main(): Promise<void> {
  const options = parseArgs(process.argv.slice(2));
  const profile = resolvePublishNetwork(options.network);
  const privateKey = normalizePrivateKey(requireEnv('VINCENT_PUBLISHER_PRIVATE_KEY'));
  const rpcUrl = requireEnv(profile.rpcEnvVar);
  assertJsonRpcUrl(rpcUrl, profile.rpcEnvVar);
  const irysGatewayUrl = resolveIrysGatewayUrl(profile.chainId, process.env.IRYS_GATEWAY_URL);
  const irysGraphqlUrl = optionalEnv('IRYS_GRAPHQL_URL', IRYS_GRAPHQL_URL);
  assertIrysGraphqlUrl(irysGraphqlUrl, 'IRYS_GRAPHQL_URL');

  const publisher = toChecksumAddress(addressFromPrivateKey(privateKey));
  const chainLabel = profile.chain.name ?? profile.id;

  process.stdout.write(`Community publisher: ${publisher}\n`);
  process.stdout.write(
    `Base epoch: ${options.basePublisher} index ${String(options.baseIndex)}\n`,
  );

  const communityClaimsJsonl = readFileSync(options.claimsPath, 'utf8');
  const archiveBytes = new Uint8Array(readFileSync(options.archivePath));

  const anchorReader = createAnchorReader({ chain: profile.chain, rpcUrl });
  process.stdout.write('Fetching and verifying base epoch from the registry...\n');
  const base = await fetchBaseEpoch({
    reader: anchorReader,
    gatewayUrl: irysGatewayUrl,
    publisher: options.basePublisher,
    index: options.baseIndex,
  });
  process.stdout.write(
    `Base epoch ${String(base.manifest.epoch)} verified: ` +
      `${String(base.claims.length)} claims, jsonlSha256 ${base.manifest.dataset.jsonlSha256}\n`,
  );

  const chainPublisher = createRegistryPublisher({
    privateKeyHex: privateKey,
    chain: profile.chain,
    rpcUrl,
  });

  const uploader = await createIrysUploader({
    chainId: profile.chainId,
    privateKeyHex: privateKey,
    rpcUrl,
    onUploadRetry: ({ attempt, maxAttempts, error }) => {
      const detail = error instanceof Error ? error.message : String(error);
      process.stderr.write(
        `Irys upload retry ${String(attempt)}/${String(maxAttempts)} (${detail})\n`,
      );
    },
  });

  const isLarge = base.claims.length > LARGE_EPOCH_CLAIM_THRESHOLD;
  const indexDefaults = resolveIndexCheckDefaults(
    profile,
    isLarge ? 'full' : 'genesis-mini',
    options.anchorOnly,
    {
      indexCheckConcurrency: options.indexCheckConcurrency,
      indexCheckDelayMs: options.indexCheckDelayMs,
      indexCheckTimeoutMs: options.indexCheckTimeoutMs,
      allowReupload: options.allowReupload ? true : undefined,
      maxReuploadLeaves: options.maxReuploadLeaves,
    },
  );

  const result = await publishCommunityEpoch({
    baseClaims: base.claims,
    communityClaimsJsonl,
    archiveBytes,
    signerKeyHex: privateKey,
    uploader,
    chainPublisher,
    checkpointPath: options.checkpointFile,
    jitter: {
      jitterDays: options.jitterDays,
      force: options.force,
    },
    preflight: {
      rpcUrl,
      irysGraphqlUrl,
      chainId: profile.chainId,
      chain: profile.chain,
      networkId: profile.id,
    },
    uploadBudget: {
      onStart: (leafCount: number) => {
        process.stdout.write(
          `Upload budget preflight (${String(leafCount)} leaves; remaining bytes only)...\n`,
        );
      },
      onQuote: (quote: UploadBudgetQuote) => {
        process.stdout.write(
          `Irys quote: ${formatEther(quote.estimatedCostWei)} ETH ` +
            `(need ${formatEther(quote.requiredWei)} ETH on Irys, ` +
            `funded ${formatEther(quote.irysLoadedBalanceWei)} ETH, ` +
            `${chainLabel} wallet ${formatEther(quote.walletBalanceWei)} ETH` +
            (quote.deficitWei > 0n ? `, fund ${formatEther(quote.deficitWei)} ETH` : '') +
            `)\n`,
        );
      },
      onFund: (deficitWei: bigint) => {
        process.stdout.write(
          `Funding Irys account with ${deficitWei.toString()} wei from ${chainLabel}...\n`,
        );
      },
      onFundTxSubmitted: (txId: `0x${string}`) => {
        process.stdout.write(
          `Submitted Irys fund tx ${txId}; waiting for ${chainLabel} confirmation...\n`,
        );
      },
    },
    uploadScope: options.retryFailed ? 'failed-only' : 'all',
    uploadConcurrency:
      options.uploadConcurrency ?? (isLarge ? DEFAULT_FULL_UPLOAD_CONCURRENCY : 1),
    phases: {
      uploadLeaves: !options.anchorOnly,
      uploadArtifacts: !options.anchorOnly && !options.retryFailed,
      indexCheck: !options.uploadOnly && !options.retryFailed,
      anchor: !options.uploadOnly && !options.retryFailed,
    },
    onProgress: createProgressLogger(
      isLarge ? 250 : 1,
      isLarge ? DEFAULT_FULL_INDEX_CHECK_LOG_INTERVAL : 1,
    ),
    onHint: (message) => {
      process.stderr.write(`${message}\n`);
    },
    leafIndexCheck: {
      gatewayUrl: irysGatewayUrl,
      graphqlUrl: irysGraphqlUrl,
      timeoutMs: indexDefaults.timeoutMs,
      delayMs: indexDefaults.delayMs,
      concurrency: indexDefaults.concurrency,
      maxReuploadAttempts: indexDefaults.maxReuploadAttempts,
      postReuploadDelayMs: indexDefaults.postReuploadDelayMs,
      reuploadOnFailure: indexDefaults.reuploadOnFailure,
      maxReuploadLeaves: indexDefaults.maxReuploadLeaves,
      gatewayFallback: true,
      skipGraphqlPoll: true,
      onDelay: (delayMs) => {
        process.stdout.write(
          `Waiting ${String(Math.round(delayMs / 1000))}s for Irys bundler index catch-up...\n`,
        );
      },
      onLeafFailed: (leafKey, error) => {
        process.stderr.write(`Index-check FAILED for LeafKey ${leafKey}: ${error}\n`);
      },
    },
  });

  process.stdout.write(
    `Snapshot: ${String(result.assembled.baseClaimCount)} base + ` +
      `${String(result.assembled.communityClaimCount)} community = ` +
      `${String(result.assembled.mergedClaimCount)} claims\n`,
  );
  process.stdout.write(
    `Review policy: minAccepts ${String(result.assembled.reviewPolicy.minAccepts)}, ` +
      `${String(result.assembled.reviewPolicy.reviewers.length)} reviewer(s)\n`,
  );

  if (result.status === 'window-pending') {
    // §4.8 publish window: no sleeping process — the key stays offline between runs.
    process.stdout.write(
      `Publish window opens ${result.publishNotBefore} (persisted in the checkpoint).\n` +
        `No uploads or anchor were performed. Re-run the exact same command after that ` +
        `timestamp to publish epoch ${String(result.epochNumber)}.\n`,
    );
    return;
  }

  const report = result.report;
  process.stdout.write(`epoch: ${String(report.manifest.epoch)}\n`);
  process.stdout.write(`parent: ${report.manifest.parent ?? 'null (own-chain genesis)'}\n`);
  process.stdout.write(`publisher: ${report.publisher}\n`);
  process.stdout.write(`jsonlUri: ${report.jsonlUri}\n`);
  process.stdout.write(`manifestUri: ${report.manifestUri}\n`);
  process.stdout.write(`manifestHash: ${report.manifestHash}\n`);
  process.stdout.write(`reviewArchiveUri: ${result.reviewArchiveUri ?? '(not uploaded)'}\n`);
  process.stdout.write(`txHash: ${report.txHash}\n`);
  process.stdout.write(`explorer: ${profile.explorerTxUrl}${report.txHash}\n`);

  if (options.uploadOnly || options.retryFailed) {
    process.stdout.write(
      'Uploads complete. Re-run without --upload-only/--retry-failed to index-check and anchor.\n',
    );
    return;
  }

  const onChain = await chainPublisher.waitForLatestEpoch(publisher as `0x${string}`, {
    minEpochCount: BigInt(report.manifest.epoch),
    expectedManifestUri: report.manifestUri,
  });
  const failures: string[] = [];
  if (onChain.merkleRoot !== sha256ContentIdToBytes32(report.manifest.dataset.merkleRoot)) {
    failures.push('on-chain merkleRoot mismatch');
  }
  if (onChain.jsonlSha256 !== sha256ContentIdToBytes32(report.manifest.dataset.jsonlSha256)) {
    failures.push('on-chain jsonlSha256 mismatch');
  }
  if (onChain.manifestHash !== sha256ContentIdToBytes32(report.manifestHash)) {
    failures.push('on-chain manifestHash mismatch');
  }
  for (const failure of failures) {
    process.stdout.write(`FAIL ${failure}\n`);
  }
  process.stdout.write(
    failures.length === 0 ? 'PASS on-chain verification\n' : 'FAIL on-chain verification\n',
  );
  if (failures.length > 0) {
    process.exitCode = 1;
  }
}

main().catch((error: unknown) => {
  const message = error instanceof Error ? error.message : String(error);
  process.stderr.write(`${message}\n`);
  process.exitCode = 1;
});
