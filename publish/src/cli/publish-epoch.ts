import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { config as loadEnv } from 'dotenv';

import { compile } from '@kargain/vincent-compiler';
import {
  addressFromPrivateKey,
  parseManifest,
  toChecksumAddress,
  type Claim,
} from '@kargain/vincent/protocol';
import { formatEther } from 'viem';

import { createRegistryPublisher, createRegistryReader } from '../adapters/registry-publisher.js';
import { createIrysUploader } from '../adapters/irys-uploader.js';
import { IRYS_GRAPHQL_URL } from '../constants.js';
import { loadFullSeedClaims } from '../load-full-seed-claims.js';
import { preflightEpochPublish } from '../preflight-genesis-publish.js';
import {
  DEFAULT_FULL_INDEX_CHECK_LOG_INTERVAL,
  DEFAULT_FULL_UPLOAD_CONCURRENCY,
} from '../constants.js';
import { parseNetworkFlags } from './parse-network-flags.js';
import {
  resolveIndexCheckDefaults,
  resolveIrysGatewayUrl,
  resolvePublishNetwork,
  type PublishNetworkId,
} from '../publish-network.js';
import {
  failedLeafKeySet,
  loadCheckpoint,
  loadOrCreateCheckpoint,
  uploadedLeafKeySet,
  writeLeafUriBackfillHintIfNeeded,
} from '../publish-checkpoint.js';
import { publishEpoch, type PublishEpochProgress } from '../publish-epoch.js';
import {
  computeRemainingUploadByteSizes,
  type UploadBudgetQuote,
} from '../estimate-epoch-upload-cost.js';
import { resolveEpochParent } from '../resolve-epoch-parent.js';
import { manifestHash } from '../sign-manifest.js';
import {
  assertJsonRpcUrl,
  assertIrysGraphqlUrl,
} from '../validate-env-urls.js';
import { verifyGenesisPublish } from '../verify-genesis-publish.js';
import type { PublishGenesisReport } from '../adapters/types.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const PUBLISH_ROOT = join(__dirname, '../..');
const REPO_ROOT = join(__dirname, '../../..');

loadEnv({ path: join(PUBLISH_ROOT, '.env') });

function writeCliHint(message: string): void {
  process.stderr.write(`${message}\n`);
}

interface CliOptions {
  network: PublishNetworkId;
  genesis: boolean;
  fixture: 'genesis-mini' | 'full';
  verifyOnly: boolean;
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
  publisher?: string;
  manifestUri?: string;
  leafUrisUri?: string;
  publishLeafUrisSidecar: boolean;
  discoverLeafUriSidecar: boolean;
}

function parseArgs(argv: string[]): CliOptions {
  const network = parseNetworkFlags(argv);
  const genesis = argv.includes('--genesis');
  const verifyOnly = argv.includes('--verify-only');
  const uploadOnly = argv.includes('--upload-only');
  const anchorOnly = argv.includes('--anchor-only');
  const retryFailed = argv.includes('--retry-failed');
  const allowReupload = argv.includes('--allow-reupload');
  const publishLeafUrisSidecar = argv.includes('--publish-leaf-uris-sidecar');
  const discoverLeafUriSidecar = !argv.includes('--no-discover-leaf-uris-sidecar');
  const fixtureArg = argv.find((arg) => arg.startsWith('--fixture='));
  const fixtureFlagIndex = argv.indexOf('--fixture');
  const publisherArg = argv.find((arg) => arg.startsWith('--publisher='));
  const publisherFlagIndex = argv.indexOf('--publisher');
  const manifestArg = argv.find((arg) => arg.startsWith('--manifest-uri='));
  const manifestFlagIndex = argv.indexOf('--manifest-uri');
  let fixture: CliOptions['fixture'] = 'genesis-mini';

  if (fixtureArg !== undefined) {
    const value = fixtureArg.slice('--fixture='.length);
    if (value !== 'genesis-mini' && value !== 'full') {
      throw new Error('--fixture must be genesis-mini or full');
    }
    fixture = value;
  } else if (fixtureFlagIndex >= 0) {
    const value = argv[fixtureFlagIndex + 1];
    if (value !== 'genesis-mini' && value !== 'full') {
      throw new Error('--fixture must be genesis-mini or full');
    }
    fixture = value;
  }

  if (argv.includes('--full')) {
    fixture = 'full';
  }

  if (uploadOnly && anchorOnly) {
    throw new Error('--upload-only and --anchor-only are mutually exclusive');
  }
  if (retryFailed && anchorOnly) {
    throw new Error('--retry-failed and --anchor-only are mutually exclusive');
  }

  const concurrencyArg = argv.find((arg) => arg.startsWith('--upload-concurrency='));
  const concurrencyFlagIndex = argv.indexOf('--upload-concurrency');
  let uploadConcurrency: number | undefined;
  if (concurrencyArg !== undefined) {
    uploadConcurrency = Number(concurrencyArg.slice('--upload-concurrency='.length));
  } else if (concurrencyFlagIndex >= 0) {
    uploadConcurrency = Number(argv[concurrencyFlagIndex + 1]);
  }
  if (uploadConcurrency !== undefined && (!Number.isInteger(uploadConcurrency) || uploadConcurrency < 1)) {
    throw new Error('--upload-concurrency must be a positive integer');
  }

  const indexConcurrencyArg = argv.find((arg) => arg.startsWith('--index-check-concurrency='));
  const indexConcurrencyFlagIndex = argv.indexOf('--index-check-concurrency');
  let indexCheckConcurrency: number | undefined;
  if (indexConcurrencyArg !== undefined) {
    indexCheckConcurrency = Number(indexConcurrencyArg.slice('--index-check-concurrency='.length));
  } else if (indexConcurrencyFlagIndex >= 0) {
    indexCheckConcurrency = Number(argv[indexConcurrencyFlagIndex + 1]);
  }
  if (
    indexCheckConcurrency !== undefined &&
    (!Number.isInteger(indexCheckConcurrency) || indexCheckConcurrency < 1)
  ) {
    throw new Error('--index-check-concurrency must be a positive integer');
  }

  const indexDelayArg = argv.find((arg) => arg.startsWith('--index-check-delay='));
  const indexDelayFlagIndex = argv.indexOf('--index-check-delay');
  let indexCheckDelayMs: number | undefined;
  if (indexDelayArg !== undefined) {
    indexCheckDelayMs = Number(indexDelayArg.slice('--index-check-delay='.length));
  } else if (indexDelayFlagIndex >= 0) {
    indexCheckDelayMs = Number(argv[indexDelayFlagIndex + 1]);
  }
  if (
    indexCheckDelayMs !== undefined &&
    (!Number.isInteger(indexCheckDelayMs) || indexCheckDelayMs < 0)
  ) {
    throw new Error('--index-check-delay must be a non-negative integer (milliseconds)');
  }

  const indexTimeoutArg = argv.find((arg) => arg.startsWith('--index-check-timeout='));
  const indexTimeoutFlagIndex = argv.indexOf('--index-check-timeout');
  let indexCheckTimeoutMs: number | undefined;
  if (indexTimeoutArg !== undefined) {
    indexCheckTimeoutMs = Number(indexTimeoutArg.slice('--index-check-timeout='.length));
  } else if (indexTimeoutFlagIndex >= 0) {
    indexCheckTimeoutMs = Number(argv[indexTimeoutFlagIndex + 1]);
  }
  if (
    indexCheckTimeoutMs !== undefined &&
    (!Number.isInteger(indexCheckTimeoutMs) || indexCheckTimeoutMs < 1)
  ) {
    throw new Error('--index-check-timeout must be a positive integer (milliseconds)');
  }

  const maxReuploadLeavesArg = argv.find((arg) => arg.startsWith('--max-reupload-leaves='));
  const maxReuploadLeavesFlagIndex = argv.indexOf('--max-reupload-leaves');
  let maxReuploadLeaves: number | undefined;
  if (maxReuploadLeavesArg !== undefined) {
    maxReuploadLeaves = Number(maxReuploadLeavesArg.slice('--max-reupload-leaves='.length));
  } else if (maxReuploadLeavesFlagIndex >= 0) {
    maxReuploadLeaves = Number(argv[maxReuploadLeavesFlagIndex + 1]);
  }
  if (
    maxReuploadLeaves !== undefined &&
    (!Number.isInteger(maxReuploadLeaves) || maxReuploadLeaves < 0)
  ) {
    throw new Error('--max-reupload-leaves must be a non-negative integer');
  }

  const checkpointArg = argv.find((arg) => arg.startsWith('--checkpoint-file='));
  const checkpointFlagIndex = argv.indexOf('--checkpoint-file');
  let checkpointFile = join(PUBLISH_ROOT, '.vincent-publish-checkpoint.json');
  if (checkpointArg !== undefined) {
    checkpointFile = checkpointArg.slice('--checkpoint-file='.length);
  } else if (checkpointFlagIndex >= 0) {
    checkpointFile = argv[checkpointFlagIndex + 1] ?? checkpointFile;
  }

  let publisher: string | undefined;
  if (publisherArg !== undefined) {
    publisher = publisherArg.slice('--publisher='.length);
  } else if (publisherFlagIndex >= 0) {
    publisher = argv[publisherFlagIndex + 1];
  }

  let manifestUri: string | undefined;
  if (manifestArg !== undefined) {
    manifestUri = manifestArg.slice('--manifest-uri='.length);
  } else if (manifestFlagIndex >= 0) {
    manifestUri = argv[manifestFlagIndex + 1];
  }

  const leafUrisUriArg = argv.find((arg) => arg.startsWith('--leaf-uris-uri='));
  const leafUrisUriFlagIndex = argv.indexOf('--leaf-uris-uri');
  let leafUrisUri: string | undefined;
  if (leafUrisUriArg !== undefined) {
    leafUrisUri = leafUrisUriArg.slice('--leaf-uris-uri='.length);
  } else if (leafUrisUriFlagIndex >= 0) {
    leafUrisUri = argv[leafUrisUriFlagIndex + 1];
  }

  return {
    network,
    genesis,
    fixture,
    verifyOnly,
    uploadOnly,
    anchorOnly,
    retryFailed,
    allowReupload,
    maxReuploadLeaves,
    uploadConcurrency,
    indexCheckConcurrency,
    indexCheckDelayMs,
    indexCheckTimeoutMs,
    checkpointFile,
    publisher,
    manifestUri,
    leafUrisUri,
    publishLeafUrisSidecar,
    discoverLeafUriSidecar,
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

function optionalFundTxId(): `0x${string}` | undefined {
  const value = process.env.VINCENT_IRYS_RECOVER_FUND_TX;
  if (value === undefined || value.length === 0) {
    return undefined;
  }
  const normalized = (value.startsWith('0x') ? value : `0x${value}`) as `0x${string}`;
  if (!/^0x[0-9a-fA-F]{64}$/.test(normalized)) {
    throw new Error('VINCENT_IRYS_RECOVER_FUND_TX must be a 32-byte hex transaction hash');
  }
  return normalized;
}

function normalizePrivateKey(value: string): `0x${string}` {
  return (value.startsWith('0x') ? value : `0x${value}`) as `0x${string}`;
}

function loadGenesisMiniClaims(): Claim[] {
  const path = join(REPO_ROOT, 'compiler/fixtures/genesis-mini/claims.json');
  return JSON.parse(readFileSync(path, 'utf8')) as Claim[];
}

function arUriToGatewayUrl(gatewayUrl: string, uri: string): string {
  if (!uri.startsWith('ar://')) {
    throw new Error(`Expected ar:// URI, got ${uri}`);
  }
  const id = uri.slice('ar://'.length);
  return `${gatewayUrl.replace(/\/+$/, '')}/${id}`;
}

async function fetchManifestFromGateway(
  gatewayUrl: string,
  manifestUri: string,
): Promise<PublishGenesisReport['manifest']> {
  const response = await fetch(arUriToGatewayUrl(gatewayUrl, manifestUri));
  if (!response.ok) {
    throw new Error(`Failed to fetch manifest: ${response.status}`);
  }
  const parsed = parseManifest(await response.json());
  if (!parsed.ok) {
    throw new Error(`Invalid manifest: ${parsed.error.message}`);
  }
  return parsed.value;
}

async function runVerifyOnly(options: CliOptions): Promise<void> {
  if (options.publisher === undefined || options.manifestUri === undefined) {
    throw new Error(
      'Usage: publish-epoch --network base-sepolia|--devnet --verify-only --publisher <address> --manifest-uri ar://...',
    );
  }

  const profile = resolvePublishNetwork(options.network);
  const rpcUrl = requireEnv(profile.rpcEnvVar);
  assertJsonRpcUrl(rpcUrl, profile.rpcEnvVar);
  const irysGatewayUrl = resolveIrysGatewayUrl(
    profile.chainId,
    process.env.IRYS_GATEWAY_URL,
  );
  const irysGraphqlUrl = optionalEnv('IRYS_GRAPHQL_URL', IRYS_GRAPHQL_URL);
  assertIrysGraphqlUrl(irysGraphqlUrl, 'IRYS_GRAPHQL_URL');
  const publisher = toChecksumAddress(options.publisher);

  const chainPublisher = createRegistryReader({ chain: profile.chain, rpcUrl });

  process.stdout.write(`Verify-only for publisher: ${publisher}\n`);
  process.stdout.write(`Manifest URI: ${options.manifestUri}\n`);

  const manifest = await fetchManifestFromGateway(irysGatewayUrl, options.manifestUri);
  const hash = manifestHash(manifest);
  const jsonlUri = manifest.dataset.uris[0];
  if (jsonlUri === undefined) {
    throw new Error('Manifest dataset.uris is empty');
  }

  const report: PublishGenesisReport = {
    publisher,
    jsonlUri,
    manifestUri: options.manifestUri,
    manifestHash: hash,
    txHash: `0x${'0'.repeat(64)}`,
    leafCount: 0,
    manifest,
  };

  const checkpoint = loadCheckpoint(options.checkpointFile);
  if (checkpoint !== null) {
    writeLeafUriBackfillHintIfNeeded(checkpoint, writeCliHint);
  }

  let ok = true;
  const verification = await verifyGenesisPublish({
    report,
    chainPublisher,
    gatewayUrl: irysGatewayUrl,
    graphqlUrl: irysGraphqlUrl,
    fixture: options.fixture,
    epochNumber: manifest.epoch,
    leafUris: checkpoint?.leafUris,
    leafUriSidecarUri: options.leafUrisUri ?? checkpoint?.leafUriSidecarUri,
    discoverLeafUriSidecar: options.discoverLeafUriSidecar,
    waitForLatestEpochOptions: {
      minEpochCount: BigInt(manifest.epoch),
      expectedManifestUri: options.manifestUri,
    },
  });
  for (const failure of verification.failures) {
    process.stdout.write(`FAIL ${failure}\n`);
    ok = false;
  }

  process.stdout.write(ok ? 'PASS live verification\n' : 'FAIL live verification\n');
  if (!ok) {
    process.exitCode = 1;
  }
}

function formatProgressPercent(completed: number, total: number): string {
  if (total <= 0) {
    return '0%';
  }
  return `${((completed / total) * 100).toFixed(1)}%`;
}

function createPublishProgressLogger(leafLogInterval: number, indexCheckLogInterval: number) {
  let lastLeafLogAt = 0;
  let lastIndexLogAt = 0;

  return (progress: PublishEpochProgress): void => {
    switch (progress.phase) {
      case 'leaves': {
        const shouldLog =
          progress.completed === 0 ||
          progress.completed === progress.total ||
          progress.completed - lastLeafLogAt >= leafLogInterval;
        if (!shouldLog) {
          return;
        }
        lastLeafLogAt = progress.completed;
        const resumePart =
          progress.skipped !== undefined
            ? `; uploaded ${String(progress.uploaded ?? 0)}, skipped ${String(progress.skipped)}`
            : '';
        process.stdout.write(
          `Uploading leaves ${String(progress.completed)}/${String(progress.total)} ` +
            `(${formatProgressPercent(progress.completed, progress.total)})${resumePart}...\n`,
        );
        return;
      }
      case 'jsonl':
        if (progress.completed === 0) {
          process.stdout.write('Uploading JSONL...\n');
        }
        return;
      case 'manifest':
        if (progress.completed === 0) {
          process.stdout.write('Uploading manifest...\n');
        }
        return;
      case 'index-check': {
        const shouldLog =
          progress.completed === 0 ||
          progress.completed === progress.total ||
          progress.completed - lastIndexLogAt >= indexCheckLogInterval;
        if (!shouldLog) {
          return;
        }
        lastIndexLogAt = progress.completed;
        process.stdout.write(
          `Verifying GraphQL index ${String(progress.completed)}/${String(progress.total)} ` +
            `(${formatProgressPercent(progress.completed, progress.total)})...\n`,
        );
        return;
      }
      case 'anchor':
        if (progress.completed === 0) {
          process.stdout.write('Anchoring on chain...\n');
        }
        return;
      default:
        return;
    }
  };
}

async function runPublish(options: CliOptions): Promise<void> {
  const profile = resolvePublishNetwork(options.network);
  const privateKey = normalizePrivateKey(requireEnv('VINCENT_GENESIS_PRIVATE_KEY'));
  const rpcUrl = requireEnv(profile.rpcEnvVar);
  assertJsonRpcUrl(rpcUrl, profile.rpcEnvVar);
  const irysGatewayUrl = resolveIrysGatewayUrl(
    profile.chainId,
    process.env.IRYS_GATEWAY_URL,
  );
  const irysGraphqlUrl = optionalEnv('IRYS_GRAPHQL_URL', IRYS_GRAPHQL_URL);
  assertIrysGraphqlUrl(irysGraphqlUrl, 'IRYS_GRAPHQL_URL');
  const publisher = toChecksumAddress(addressFromPrivateKey(privateKey));
  const chainLabel = profile.chain.name ?? profile.id;

  const chainPublisher = createRegistryPublisher({
    privateKeyHex: privateKey,
    chain: profile.chain,
    rpcUrl,
  });

  const preflightOptions = {
    rpcUrl,
    irysGraphqlUrl,
    chainId: profile.chainId,
    chain: profile.chain,
    networkId: profile.id,
  };
  const resolved = await resolveEpochParent(chainPublisher, publisher as `0x${string}`);
  const mode =
    resolved.epochNumber === 1
      ? options.genesis
        ? 'genesis (--genesis)'
        : 'genesis (auto)'
      : `incremental epoch ${String(resolved.epochNumber)}`;
  const parentLabel =
    resolved.parentRootContentId === null ? 'null (genesis)' : resolved.parentRootContentId;

  process.stdout.write(`Publisher: ${publisher}\n`);
  process.stdout.write(`Mode: ${mode}\n`);
  process.stdout.write(`Epoch: ${String(resolved.epochNumber)}\n`);
  process.stdout.write(`Parent: ${parentLabel}\n`);

  process.stdout.write(`Loading claims (${options.fixture})...\n`);
  const claims =
    options.fixture === 'full' ? await loadFullSeedClaims() : loadGenesisMiniClaims();

  process.stdout.write(`Compiling ${String(claims.length)} claims...\n`);
  const built = compile(claims, {});
  if (!built.ok) {
    throw new Error(built.error.message);
  }

  const fingerprint = {
    publisher,
    epochNumber: resolved.epochNumber,
    merkleRoot: built.value.merkleRoot,
    jsonlSha256: built.value.jsonlSha256,
  };
  const checkpoint = loadOrCreateCheckpoint(options.checkpointFile, fingerprint);
  const uploadedSet = uploadedLeafKeySet(checkpoint);
  const failedSet = failedLeafKeySet(checkpoint);
  const totalLeaves = built.value.leaves.size;

  process.stdout.write(
    `Checkpoint: uploaded ${String(uploadedSet.size)} | ` +
      `index-verified ${String(checkpoint.indexVerifiedLeafKeys.length)} | ` +
      `failed ${String(failedSet.size)} / ${String(totalLeaves)}\n`,
  );

  if (options.retryFailed && failedSet.size === 0) {
    process.stdout.write('No failed leaves recorded in the checkpoint; nothing to retry.\n');
    return;
  }

  if (options.retryFailed) {
    process.stdout.write(
      `Retry-failed: re-uploading ${String(failedSet.size)} failed leaves (no index-check or anchor)\n`,
    );
  } else if (!options.anchorOnly) {
    process.stdout.write(
      `Remaining uploads: ${String(totalLeaves - uploadedSet.size)} leaves; concurrency ${String(
        options.uploadConcurrency ?? (options.fixture === 'full' ? DEFAULT_FULL_UPLOAD_CONCURRENCY : 1),
      )}\n`,
    );
  }

  // --retry-failed quotes only the failed leaf bytes; everything else counts as completed.
  const budgetCompletedLeafKeys = options.retryFailed
    ? new Set([...built.value.leaves.keys()].filter((leafKey) => !failedSet.has(leafKey)))
    : uploadedSet;

  const uploadBudget = options.anchorOnly
    ? undefined
    : {
        epoch: built.value,
        epochNumber: resolved.epochNumber,
        parentRootContentId: resolved.parentRootContentId,
        recoverFundTxId: optionalFundTxId(),
        byteSizes: computeRemainingUploadByteSizes({
          epoch: built.value,
          epochNumber: resolved.epochNumber,
          parentRoot: resolved.parentRootContentId,
          completedLeafKeys: budgetCompletedLeafKeys,
          includeJsonl: !options.retryFailed && checkpoint.jsonlUri === undefined,
          includeManifest: !options.retryFailed && checkpoint.manifestUri === undefined,
        }),
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
      };

  if (uploadBudget?.recoverFundTxId !== undefined) {
    process.stdout.write(
      `Recovering prior Irys fund tx ${uploadBudget.recoverFundTxId}...\n`,
    );
  }

  await preflightEpochPublish({
    privateKeyHex: privateKey,
    publisher,
    epochCountReader: chainPublisher,
    readLatestEpoch: chainPublisher.readLatestEpoch.bind(chainPublisher),
    preflight: {
      ...preflightOptions,
      requireGenesis: options.genesis ? true : undefined,
      targetEpochNumber: resolved.epochNumber,
      uploadBudget,
    },
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

  const indexDefaults = resolveIndexCheckDefaults(profile, options.fixture, options.anchorOnly, {
    indexCheckConcurrency: options.indexCheckConcurrency,
    indexCheckDelayMs: options.indexCheckDelayMs,
    indexCheckTimeoutMs: options.indexCheckTimeoutMs,
    allowReupload: options.allowReupload ? true : undefined,
    maxReuploadLeaves: options.maxReuploadLeaves,
  });

  const phaseLabel = options.retryFailed
    ? 'retry-failed (re-upload failed leaves only)'
    : options.anchorOnly
      ? 'anchor-only (skip leaf uploads)'
      : options.uploadOnly
        ? 'upload-only (no index-check or anchor)'
        : 'full pipeline';
  process.stdout.write(
    `Publishing epoch (${String(built.value.leaves.size)} leaves; ${phaseLabel})...\n`,
  );

  const report = await publishEpoch({
    epoch: built.value,
    signerKeyHex: privateKey,
    uploader,
    chainPublisher,
    requireGenesis: options.genesis ? true : undefined,
    checkpointPath: options.checkpointFile,
    onHint: writeCliHint,
    leafUriSidecar: options.publishLeafUrisSidecar
      ? {
          publish: true,
          onWarning: writeCliHint,
        }
      : undefined,
    uploadScope: options.retryFailed ? 'failed-only' : 'all',
    uploadConcurrency:
      options.uploadConcurrency ?? (options.fixture === 'full' ? DEFAULT_FULL_UPLOAD_CONCURRENCY : 1),
    phases: {
      uploadLeaves: !options.anchorOnly,
      uploadArtifacts: !options.anchorOnly && !options.retryFailed,
      indexCheck: !options.uploadOnly && !options.retryFailed,
      anchor: !options.uploadOnly && !options.retryFailed,
    },
    onProgress: createPublishProgressLogger(
      options.fixture === 'full' ? 250 : 1,
      options.fixture === 'full' ? DEFAULT_FULL_INDEX_CHECK_LOG_INTERVAL : 1,
    ),
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
      onReupload: (leafKey, attempt, maxAttempts) => {
        process.stderr.write(
          `Re-uploading LeafKey ${leafKey} (${String(attempt)}/${String(maxAttempts)}) ` +
            'after GraphQL index miss...\n',
        );
      },
      onLeafFailed: (leafKey, error) => {
        process.stderr.write(`Index-check FAILED for LeafKey ${leafKey}: ${error}\n`);
      },
    },
  });

  if (options.retryFailed) {
    process.stdout.write(
      'Retry-failed complete. Re-run with --anchor-only to index-check the remaining leaves and anchor.\n',
    );
    return;
  }

  process.stdout.write(`publisher: ${report.publisher}\n`);
  process.stdout.write(`jsonlUri: ${report.jsonlUri}\n`);
  process.stdout.write(`manifestUri: ${report.manifestUri}\n`);
  process.stdout.write(`manifestHash: ${report.manifestHash}\n`);
  process.stdout.write(`txHash: ${report.txHash}\n`);
  process.stdout.write(`explorer: ${profile.explorerTxUrl}${report.txHash}\n`);

  let ok = true;

  const verification = await verifyGenesisPublish({
    report,
    chainPublisher,
    gatewayUrl: irysGatewayUrl,
    graphqlUrl: irysGraphqlUrl,
    fixture: options.fixture,
    leafUris: loadCheckpoint(options.checkpointFile)?.leafUris,
    leafUriSidecarUri:
      loadCheckpoint(options.checkpointFile)?.leafUriSidecarUri,
    discoverLeafUriSidecar: options.discoverLeafUriSidecar,
    waitForLatestEpochOptions: {
      minEpochCount: BigInt(report.manifest.epoch),
      expectedManifestUri: report.manifestUri,
    },
  });
  for (const failure of verification.failures) {
    process.stdout.write(`FAIL ${failure}\n`);
    ok = false;
  }

  process.stdout.write(ok ? 'PASS live verification\n' : 'FAIL live verification\n');
  if (!ok) {
    process.exitCode = 1;
  }
}

async function main(): Promise<void> {
  const options = parseArgs(process.argv.slice(2));

  if (options.verifyOnly) {
    await runVerifyOnly(options);
    return;
  }

  await runPublish(options);
}

main().catch((error: unknown) => {
  const message = error instanceof Error ? error.message : String(error);
  process.stderr.write(`${message}\n`);
  process.exitCode = 1;
});
