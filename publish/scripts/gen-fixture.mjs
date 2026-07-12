/**
 * Dev script: regenerate publish/fixtures genesis-mini manifest + golden manifestHash.
 * Run: pnpm --filter @kargain/vincent-publish build && node publish/scripts/gen-fixture.mjs
 */
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { buildManifest, manifestHash, signManifest } from '../dist/index.js';
import { TEST_PRIVATE_KEY } from '../dist/constants.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const FIXTURE_DIR = join(__dirname, '../fixtures');
const COMPILER_GOLDEN = join(__dirname, '../../compiler/fixtures/genesis-mini/golden.json');

const golden = JSON.parse(readFileSync(COMPILER_GOLDEN, 'utf8'));

const unsigned = buildManifest({
  epoch: 1,
  parentRoot: null,
  merkleRoot: golden.merkleRoot,
  jsonlSha256: golden.jsonlSha256,
  uris: ['ar://genesis-mini'],
  compiler: { name: 'vincent-compiler', version: '1.0.0' },
});

const manifest = signManifest(unsigned, TEST_PRIVATE_KEY);
const hash = manifestHash(manifest);

mkdirSync(FIXTURE_DIR, { recursive: true });
writeFileSync(join(FIXTURE_DIR, 'manifest.json'), `${JSON.stringify(manifest, null, 2)}\n`);
writeFileSync(join(FIXTURE_DIR, 'golden.json'), `${JSON.stringify({ manifestHash: hash }, null, 2)}\n`);

process.stdout.write(`manifestHash=${hash}\n`);
