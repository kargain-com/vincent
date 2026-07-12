/**
 * Regenerate packages/vincent/test/protocol/fixtures/golden.json attestations + manifest.
 * Run: pnpm --filter @kargain/vincent build && node packages/vincent/scripts/gen-golden.mjs
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  attest,
  claimHash,
  manifestHash,
  signManifest,
} from '../dist/protocol/index.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const goldenPath = join(__dirname, '../test/protocol/fixtures/golden.json');
const golden = JSON.parse(readFileSync(goldenPath, 'utf8'));

const { privateKey, claims } = golden;
const schemaHash = claimHash(claims.vdsSchema);
const normalizedClaims = {
  wmi: claims.wmi,
  vdsSchema: claims.vdsSchema,
  vdsBinding: {
    ...claims.vdsBinding,
    key: { ...claims.vdsBinding.key, schema: schemaHash },
  },
  vdsPattern: {
    ...claims.vdsPattern,
    key: { ...claims.vdsPattern.key, schema: schemaHash },
  },
  yearHint: claims.yearHint,
};

const hashes = {
  wmi: claimHash(normalizedClaims.wmi),
  vdsSchema: claimHash(normalizedClaims.vdsSchema),
  vdsBinding: claimHash(normalizedClaims.vdsBinding),
  vdsPattern: claimHash(normalizedClaims.vdsPattern),
  yearHint: claimHash(normalizedClaims.yearHint),
};

const attestations = {
  wmi: attest(hashes.wmi, privateKey),
  vdsSchema: attest(hashes.vdsSchema, privateKey),
  vdsBinding: attest(hashes.vdsBinding, privateKey),
  vdsPattern: attest(hashes.vdsPattern, privateKey),
  yearHint: attest(hashes.yearHint, privateKey),
};

const manifestClaims = [
  hashes.wmi,
  hashes.vdsSchema,
  hashes.vdsBinding,
  hashes.vdsPattern,
  hashes.yearHint,
].sort();

const manifest = signManifest(
  {
    schemaVersion: golden.manifest.schemaVersion,
    epoch: golden.manifest.epoch,
    parent: null,
    reviewPolicy: golden.manifest.reviewPolicy,
    claims: manifestClaims,
    compiler: golden.manifest.compiler,
    dataset: golden.manifest.dataset,
  },
  privateKey,
);

const updated = {
  privateKey: golden.privateKey,
  address: golden.address,
  claims: normalizedClaims,
  attestations,
  manifest,
  hashes: {
    ...hashes,
    manifest: manifestHash(manifest),
  },
};

writeFileSync(goldenPath, `${JSON.stringify(updated, null, 2)}\n`);
process.stdout.write(`${JSON.stringify(updated.hashes, null, 2)}\n`);
