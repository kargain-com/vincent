import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { config as loadEnv } from 'dotenv';
import { addressFromPrivateKey, toChecksumAddress } from '@kargain/vincent/protocol';

import { createIrysUploader } from '../adapters/irys-uploader.js';
import { backfillLeafUrisFromGraphql } from '../backfill-leaf-uris.js';
import { IRYS_GRAPHQL_URL } from '../constants.js';
import { publishLeafUriSidecarFromCheckpoint } from '../leaf-uri-sidecar.js';
import {
  loadCheckpoint,
  mergeLeafUris,
  saveCheckpoint,
  setLeafUriSidecarUri,
  validateCheckpointFingerprint,
} from '../publish-checkpoint.js';
import { resolvePublishNetwork } from '../publish-network.js';
import { assertIrysGraphqlUrl, assertJsonRpcUrl } from '../validate-env-urls.js';
import { parseNetworkFlags } from './parse-network-flags.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const PUBLISH_ROOT = join(__dirname, '../..');

loadEnv({ path: join(PUBLISH_ROOT, '.env') });

interface CliOptions {
  network: ReturnType<typeof parseNetworkFlags>;
  epochNumber?: number;
  checkpointFile: string;
  skipBackfill: boolean;
}

export function parsePublishLeafUrisArgs(argv: string[]): CliOptions {
  const network = parseNetworkFlags(argv);
  const skipBackfill = argv.includes('--skip-backfill');

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

  return { network, epochNumber, checkpointFile, skipBackfill };
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
  const options = parsePublishLeafUrisArgs(process.argv.slice(2));
  const profile = resolvePublishNetwork(options.network);
  const privateKey = normalizePrivateKey(requireEnv('VINCENT_GENESIS_PRIVATE_KEY'));
  const rpcUrl = requireEnv(profile.rpcEnvVar);
  assertJsonRpcUrl(rpcUrl, profile.rpcEnvVar);
  const graphqlUrl = optionalEnv('IRYS_GRAPHQL_URL', IRYS_GRAPHQL_URL);
  assertIrysGraphqlUrl(graphqlUrl, 'IRYS_GRAPHQL_URL');
  const publisher = toChecksumAddress(addressFromPrivateKey(privateKey));

  let checkpoint = loadCheckpoint(options.checkpointFile);
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

  if (!options.skipBackfill && Object.keys(checkpoint.leafUris).length === 0) {
    process.stdout.write('Checkpoint leafUris empty; running GraphQL backfill...\n');
    const result = await backfillLeafUrisFromGraphql({
      graphqlUrl,
      publisher,
      epoch: epochNumber,
    });
    checkpoint = mergeLeafUris(checkpoint, result.leafUris);
    saveCheckpoint(options.checkpointFile, checkpoint);
    process.stdout.write(
      `Backfill merged ${String(Object.keys(result.leafUris).length)} leaf uris into checkpoint\n`,
    );
  }

  const uploader = await createIrysUploader({
    chainId: profile.chainId,
    privateKeyHex: privateKey,
    rpcUrl,
  });

  const published = await publishLeafUriSidecarFromCheckpoint({ uploader, checkpoint });
  const updated = setLeafUriSidecarUri(checkpoint, published.uri);
  saveCheckpoint(options.checkpointFile, updated);

  process.stdout.write(
    `Published leaf uri sidecar: ${published.uri} (${String(Object.keys(published.sidecar.leafUris).length)} leaves)\n`,
  );
}

main().catch((error: unknown) => {
  const message = error instanceof Error ? error.message : String(error);
  process.stderr.write(`${message}\n`);
  process.exitCode = 1;
});
