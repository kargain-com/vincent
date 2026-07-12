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

import { createBaseSepoliaPublisher, createBaseSepoliaReader } from '../adapters/base-sepolia-publisher.js';
import { createIrysDevnetUploader } from '../adapters/irys-devnet-uploader.js';
import { IRYS_GRAPHQL_URL, IRYS_GATEWAY_URL } from '../constants.js';
import { loadFullSeedClaims } from '../load-full-seed-claims.js';
import { preflightEpochPublish } from '../preflight-genesis-publish.js';
import { publishEpoch, type PublishEpochProgress } from '../publish-epoch.js';
import type { UploadBudgetQuote } from '../estimate-epoch-upload-cost.js';
import { resolveEpochParent } from '../resolve-epoch-parent.js';
import { manifestHash } from '../sign-manifest.js';
import {
  assertBaseSepoliaRpcUrl,
  assertIrysGraphqlUrl,
} from '../validate-env-urls.js';
import { verifyGenesisPublish } from '../verify-genesis-publish.js';
import type { PublishGenesisReport } from '../adapters/types.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const PUBLISH_ROOT = join(__dirname, '../..');
const REPO_ROOT = join(__dirname, '../../..');

loadEnv({ path: join(PUBLISH_ROOT, '.env') });

interface CliOptions {
  devnet: boolean;
  genesis: boolean;
  fixture: 'genesis-mini' | 'full';
  verifyOnly: boolean;
  publisher?: string;
  manifestUri?: string;
}

function parseArgs(argv: string[]): CliOptions {
  const devnet = argv.includes('--devnet');
  const genesis = argv.includes('--genesis');
  const verifyOnly = argv.includes('--verify-only');
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

  return { devnet, genesis, fixture, verifyOnly, publisher, manifestUri };
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
      'Usage: publish-epoch --devnet --verify-only --publisher <address> --manifest-uri ar://...',
    );
  }

  const rpcUrl = requireEnv('BASE_SEPOLIA_RPC_URL');
  assertBaseSepoliaRpcUrl(rpcUrl, 'BASE_SEPOLIA_RPC_URL');
  const irysGatewayUrl = optionalEnv('IRYS_GATEWAY_URL', IRYS_GATEWAY_URL);
  const irysGraphqlUrl = optionalEnv('IRYS_GRAPHQL_URL', IRYS_GRAPHQL_URL);
  assertIrysGraphqlUrl(irysGraphqlUrl, 'IRYS_GRAPHQL_URL');
  const publisher = toChecksumAddress(options.publisher);

  const chainPublisher = createBaseSepoliaReader({ rpcUrl });

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

  let ok = true;
  const verification = await verifyGenesisPublish({
    report,
    chainPublisher,
    gatewayUrl: irysGatewayUrl,
    graphqlUrl: irysGraphqlUrl,
    fixture: options.fixture,
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

function createPublishProgressLogger(leafLogInterval: number) {
  let lastLeafLogAt = 0;

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
        process.stdout.write(
          `Uploading leaves ${String(progress.completed)}/${String(progress.total)} ` +
            `(${formatProgressPercent(progress.completed, progress.total)})...\n`,
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
          progress.completed % Math.max(leafLogInterval, 1) === 0;
        if (!shouldLog) {
          return;
        }
        process.stdout.write(
          `Verifying GraphQL index ${String(progress.completed)}/${String(progress.total)} ` +
            `(${formatProgressPercent(progress.completed, progress.total)})...\n`,
        );
        return;
      }
      case 'anchor':
        if (progress.completed === 0) {
          process.stdout.write('Anchoring on Base Sepolia...\n');
        }
        return;
      default:
        return;
    }
  };
}

async function runPublish(options: CliOptions): Promise<void> {
  const privateKey = normalizePrivateKey(requireEnv('VINCENT_GENESIS_PRIVATE_KEY'));
  const rpcUrl = requireEnv('BASE_SEPOLIA_RPC_URL');
  assertBaseSepoliaRpcUrl(rpcUrl, 'BASE_SEPOLIA_RPC_URL');
  const irysGatewayUrl = optionalEnv('IRYS_GATEWAY_URL', IRYS_GATEWAY_URL);
  const irysGraphqlUrl = optionalEnv('IRYS_GRAPHQL_URL', IRYS_GRAPHQL_URL);
  assertIrysGraphqlUrl(irysGraphqlUrl, 'IRYS_GRAPHQL_URL');
  const publisher = toChecksumAddress(addressFromPrivateKey(privateKey));

  const chainPublisher = createBaseSepoliaPublisher({
    privateKeyHex: privateKey,
    rpcUrl,
  });

  const preflightOptions = { rpcUrl, irysGraphqlUrl };
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

  const uploadBudget = {
    epoch: built.value,
    epochNumber: resolved.epochNumber,
    parentRootContentId: resolved.parentRootContentId,
    recoverFundTxId: optionalFundTxId(),
    onStart: (leafCount: number) => {
      process.stdout.write(
        `Upload budget preflight (${String(leafCount)} leaves)...\n`,
      );
    },
    onQuote: (quote: UploadBudgetQuote) => {
      process.stdout.write(
        `Irys quote: ${formatEther(quote.estimatedCostWei)} ETH ` +
          `(need ${formatEther(quote.requiredWei)} ETH on Irys, ` +
          `funded ${formatEther(quote.irysLoadedBalanceWei)} ETH, ` +
          `Base Sepolia wallet ${formatEther(quote.walletBalanceWei)} ETH` +
          (quote.deficitWei > 0n ? `, fund ${formatEther(quote.deficitWei)} ETH` : '') +
          `)\n`,
      );
    },
    onFund: (deficitWei: bigint) => {
      process.stdout.write(
        `Funding Irys account with ${deficitWei.toString()} wei from Base Sepolia...\n`,
      );
    },
    onFundTxSubmitted: (txId: `0x${string}`) => {
      process.stdout.write(
        `Submitted Irys fund tx ${txId}; waiting for Base Sepolia confirmation...\n`,
      );
    },
  };

  if (uploadBudget.recoverFundTxId !== undefined) {
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

  const uploader = await createIrysDevnetUploader({
    privateKeyHex: privateKey,
    rpcUrl,
  });

  process.stdout.write(
    `Publishing epoch (${String(built.value.leaves.size)} leaves; sequential Irys uploads may take hours)...\n`,
  );
  const report = await publishEpoch({
    epoch: built.value,
    signerKeyHex: privateKey,
    uploader,
    chainPublisher,
    requireGenesis: options.genesis ? true : undefined,
    onProgress: createPublishProgressLogger(options.fixture === 'full' ? 250 : 1),
    leafIndexCheck: {
      gatewayUrl: irysGatewayUrl,
      graphqlUrl: irysGraphqlUrl,
      timeoutMs: options.fixture === 'full' ? 120_000 : undefined,
    },
  });

  process.stdout.write(`publisher: ${report.publisher}\n`);
  process.stdout.write(`jsonlUri: ${report.jsonlUri}\n`);
  process.stdout.write(`manifestUri: ${report.manifestUri}\n`);
  process.stdout.write(`manifestHash: ${report.manifestHash}\n`);
  process.stdout.write(`txHash: ${report.txHash}\n`);
  process.stdout.write(
    `explorer: https://sepolia.basescan.org/tx/${report.txHash}\n`,
  );

  let ok = true;

  const verification = await verifyGenesisPublish({
    report,
    chainPublisher,
    gatewayUrl: irysGatewayUrl,
    graphqlUrl: irysGraphqlUrl,
    fixture: options.fixture,
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
  if (!options.devnet) {
    throw new Error(
      'Usage: publish-epoch --devnet [--genesis] [--fixture genesis-mini|full] | --verify-only --publisher <addr> --manifest-uri ar://...',
    );
  }

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
