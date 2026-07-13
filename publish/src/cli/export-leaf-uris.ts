import { writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { config as loadEnv } from 'dotenv';
import { addressFromPrivateKey, toChecksumAddress } from '@kargain/vincent/protocol';

import { buildLeafUriSidecarFromCheckpoint } from '../leaf-uri-sidecar.js';
import {
  loadCheckpoint,
  validateCheckpointFingerprint,
} from '../publish-checkpoint.js';
import { parseNetworkFlags } from './parse-network-flags.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const PUBLISH_ROOT = join(__dirname, '../..');

loadEnv({ path: join(PUBLISH_ROOT, '.env') });

interface CliOptions {
  epochNumber?: number;
  checkpointFile: string;
  outFile: string;
}

export function parseExportLeafUrisArgs(argv: string[]): CliOptions {
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

  const outArg = argv.find((arg) => arg.startsWith('--out='));
  const outFlagIndex = argv.indexOf('--out');
  let outFile: string | undefined;
  if (outArg !== undefined) {
    outFile = outArg.slice('--out='.length);
  } else if (outFlagIndex >= 0) {
    outFile = argv[outFlagIndex + 1];
  }
  if (outFile === undefined || outFile.length === 0) {
    throw new Error(
      'Usage: export-leaf-uris --network base-sepolia|base [--epoch=N] --out=PATH [--checkpoint-file=PATH]',
    );
  }

  const checkpointArg = argv.find((arg) => arg.startsWith('--checkpoint-file='));
  const checkpointFlagIndex = argv.indexOf('--checkpoint-file');
  let checkpointFile = join(PUBLISH_ROOT, '.vincent-publish-checkpoint.json');
  if (checkpointArg !== undefined) {
    checkpointFile = checkpointArg.slice('--checkpoint-file='.length);
  } else if (checkpointFlagIndex >= 0) {
    checkpointFile = argv[checkpointFlagIndex + 1] ?? checkpointFile;
  }

  return { epochNumber, checkpointFile, outFile };
}

function requireEnv(name: string): string {
  const value = process.env[name];
  if (value === undefined || value.length === 0) {
    throw new Error(`Missing required env var: ${name}`);
  }
  return value;
}

function normalizePrivateKey(value: string): `0x${string}` {
  return (value.startsWith('0x') ? value : `0x${value}`) as `0x${string}`;
}

async function main(): Promise<void> {
  const options = parseExportLeafUrisArgs(process.argv.slice(2));
  const privateKey = normalizePrivateKey(requireEnv('VINCENT_GENESIS_PRIVATE_KEY'));
  const publisher = toChecksumAddress(addressFromPrivateKey(privateKey));

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

  const sidecar = buildLeafUriSidecarFromCheckpoint(checkpoint);
  writeFileSync(options.outFile, `${JSON.stringify(sidecar, null, 2)}\n`, 'utf8');

  process.stdout.write(
    `Wrote leaf uri sidecar (${String(Object.keys(sidecar.leafUris).length)} leaves) to ${options.outFile}\n`,
  );
}

main().catch((error: unknown) => {
  const message = error instanceof Error ? error.message : String(error);
  process.stderr.write(`${message}\n`);
  process.exitCode = 1;
});
