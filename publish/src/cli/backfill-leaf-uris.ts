import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { config as loadEnv } from 'dotenv';
import { addressFromPrivateKey, toChecksumAddress } from '@kargain/vincent/protocol';

import { backfillLeafUrisFromGraphql } from '../backfill-leaf-uris.js';
import { IRYS_GRAPHQL_URL } from '../constants.js';
import {
  loadCheckpoint,
  mergeLeafUris,
  saveCheckpoint,
  validateCheckpointFingerprint,
} from '../publish-checkpoint.js';
import { assertIrysGraphqlUrl } from '../validate-env-urls.js';
import { parseNetworkFlags } from './parse-network-flags.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const PUBLISH_ROOT = join(__dirname, '../..');

loadEnv({ path: join(PUBLISH_ROOT, '.env') });

interface CliOptions {
  epochNumber?: number;
  checkpointFile: string;
}

function parseArgs(argv: string[]): CliOptions {
  parseNetworkFlags(argv);

  const epochArg = argv.find((arg) => arg.startsWith('--epoch='));
  const epochFlagIndex = argv.indexOf('--epoch');
  let epochNumber: number | undefined;
  if (epochArg !== undefined) {
    epochNumber = Number(epochArg.slice('--epoch='.length));
  } else if (epochFlagIndex >= 0) {
    epochNumber = Number(argv[epochFlagIndex + 1]);
  }
  if (epochNumber !== undefined && (!Number.isInteger(epochNumber) || epochNumber < 1)) {
    throw new Error('--epoch must be a positive integer');
  }

  const checkpointArg = argv.find((arg) => arg.startsWith('--checkpoint-file='));
  const checkpointFlagIndex = argv.indexOf('--checkpoint-file');
  let checkpointFile = join(PUBLISH_ROOT, '.vincent-publish-checkpoint.json');
  if (checkpointArg !== undefined) {
    checkpointFile = checkpointArg.slice('--checkpoint-file='.length);
  } else if (checkpointFlagIndex >= 0) {
    checkpointFile = argv[checkpointFlagIndex + 1] ?? checkpointFile;
  }

  return { epochNumber, checkpointFile };
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

async function main(): Promise<void> {
  const options = parseArgs(process.argv.slice(2));
  const privateKey = normalizePrivateKey(requireEnv('VINCENT_GENESIS_PRIVATE_KEY'));
  const publisher = toChecksumAddress(addressFromPrivateKey(privateKey));
  const graphqlUrl = optionalEnv('IRYS_GRAPHQL_URL', IRYS_GRAPHQL_URL);
  assertIrysGraphqlUrl(graphqlUrl, 'IRYS_GRAPHQL_URL');

  const checkpoint = loadCheckpoint(options.checkpointFile);
  if (checkpoint === null) {
    throw new Error(
      `Checkpoint not found at ${options.checkpointFile}. Run publish first or pass --checkpoint-file.`,
    );
  }

  const epochNumber = options.epochNumber ?? checkpoint.epochNumber;
  validateCheckpointFingerprint(checkpoint, {
    publisher,
    epochNumber,
    merkleRoot: checkpoint.merkleRoot,
    jsonlSha256: checkpoint.jsonlSha256,
  });

  const beforeCount = Object.keys(checkpoint.leafUris).length;

  process.stdout.write(
    `Backfilling leafUris for epoch ${String(epochNumber)} (checkpoint has ${String(beforeCount)} uris)...\n`,
  );

  const result = await backfillLeafUrisFromGraphql({
    graphqlUrl,
    publisher,
    epoch: epochNumber,
    onProgress: (progress) => {
      process.stdout.write(
        `GraphQL page ${String(progress.pagesFetched)}: ` +
          `${String(progress.transactionsScanned)} txs, ` +
          `${String(progress.leafUrisDiscovered)} leaf uris...\n`,
      );
    },
  });

  const updated = mergeLeafUris(checkpoint, result.leafUris);
  saveCheckpoint(options.checkpointFile, updated);
  const afterCount = Object.keys(updated.leafUris).length;

  process.stdout.write(
    `Done: scanned ${String(result.transactionsScanned)} txs in ${String(result.pagesFetched)} pages; ` +
      `leafUris ${String(beforeCount)} → ${String(afterCount)} (+${String(afterCount - beforeCount)})\n`,
  );
}

main().catch((error: unknown) => {
  const message = error instanceof Error ? error.message : String(error);
  process.stderr.write(`${message}\n`);
  process.exitCode = 1;
});
