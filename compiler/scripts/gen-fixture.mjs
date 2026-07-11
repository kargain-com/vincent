/**
 * Dev script: regenerate genesis-mini unsigned claims, signed manifest, golden hashes, leaves.
 * Run: pnpm --filter @kargain/vincent-compiler build && node compiler/scripts/gen-fixture.mjs
 */
import { mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { claimHash, signManifest } from '@kargain/vincent/protocol';

import { compile } from '../dist/compile.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const FIXTURE_DIR = join(__dirname, '../fixtures/genesis-mini');
const LEAVES_DIR = join(FIXTURE_DIR, 'leaves');

const privateKey = '0xac0974bec39a17e36ba4a6b4d238ff944bacb478cab039431e99c5825582831';

const vdsSchema = {
  schemaVersion: '1.1',
  type: 'vds-schema',
  key: { name: 'Genesis mini test schema' },
  value: {},
  provenance: 'regulatory/us-vpic',
  license: 'CC0-1.0',
};

const schemaHash = claimHash(vdsSchema);

const claims = [
  {
    schemaVersion: '1.0',
    type: 'wmi',
    key: { wmi: '1FA' },
    value: { manufacturer: 'Ford', country: 'US', vehicleType: 'Passenger Car', region: 'NA' },
    provenance: 'regulatory/us-vpic',
    license: 'CC0-1.0',
  },
  vdsSchema,
  {
    schemaVersion: '1.1',
    type: 'vds-binding',
    key: { wmi: '1FA', yearFrom: 2010, yearTo: 2012, schema: schemaHash },
    value: {},
    provenance: 'regulatory/us-vpic',
    license: 'CC0-1.0',
  },
  {
    schemaVersion: '1.1',
    type: 'vds-binding',
    key: { wmi: '1FA', yearFrom: 2013, yearTo: null, schema: schemaHash },
    value: {},
    provenance: 'regulatory/us-vpic',
    license: 'CC0-1.0',
  },
  {
    schemaVersion: '1.1',
    type: 'vds-pattern',
    key: { schema: schemaHash, match: { vds: '**BC' } },
    value: { attribute: 'bodyType', code: 'Sedan' },
    provenance: 'regulatory/us-vpic',
    license: 'CC0-1.0',
  },
  {
    schemaVersion: '1.1',
    type: 'vds-pattern',
    key: { schema: schemaHash, match: { vds: '**BD' } },
    value: { attribute: 'fuelType', code: 'Gasoline' },
    provenance: 'regulatory/us-vpic',
    license: 'CC0-1.0',
  },
  {
    schemaVersion: '1.1',
    type: 'vds-pattern',
    key: { schema: schemaHash, match: { vds: '**BB', vis: '*G' } },
    value: { attribute: 'model', code: 'Fusion-OLD' },
    provenance: 'regulatory/us-vpic',
    license: 'CC0-1.0',
  },
  {
    schemaVersion: '1.1',
    type: 'vds-pattern',
    key: { schema: schemaHash, match: { vds: '**BE' } },
    value: { attribute: 'plant', code: 'Chicago' },
    provenance: 'regulatory/us-vpic',
    license: 'CC0-1.0',
  },
  {
    schemaVersion: '1.0',
    type: 'wmi',
    key: { wmi: 'VF3' },
    value: { manufacturer: 'Peugeot', country: 'FR', vehicleType: 'Passenger Car', region: 'EU' },
    provenance: 'regulatory/us-vpic',
    license: 'CC0-1.0',
  },
  {
    schemaVersion: '1.0',
    type: 'year-hint',
    key: { wmi: '1FA' },
    value: { cycleRule: 'na-standard' },
    provenance: 'community/observation',
    license: 'CC0-1.0',
  },
];

const supersededModel = claims.find(
  (c) => c.type === 'vds-pattern' && c.value.code === 'Fusion-OLD',
);
if (supersededModel === undefined) {
  throw new Error('superseded model pattern not found');
}

claims.push({
  schemaVersion: '1.1',
  type: 'vds-pattern',
  key: { schema: schemaHash, match: { vds: '**BB', vis: '*G' } },
  value: { attribute: 'model', code: 'Fusion' },
  provenance: 'regulatory/us-vpic',
  license: 'CC0-1.0',
  supersedes: claimHash(supersededModel),
});

const built = compile(claims, {});
if (!built.ok) {
  throw new Error(built.error.message);
}

const claimHashes = claims.map((c) => claimHash(c)).sort();
const manifest = signManifest(
  {
    schemaVersion: '1.0',
    epoch: 1,
    reviewPolicy: {
      minAccepts: 1,
      reviewers: ['0xa0e58EC0f3dF4f127e9203A7fd6a494c483719B3'],
    },
    claims: claimHashes,
    compiler: { name: 'vincent-compiler', version: '1.0.0' },
    dataset: {
      jsonlSha256: built.value.jsonlSha256,
      merkleRoot: built.value.merkleRoot,
      uris: ['ar://genesis-mini'],
    },
  },
  privateKey,
);

mkdirSync(FIXTURE_DIR, { recursive: true });
rmSync(LEAVES_DIR, { recursive: true, force: true });
mkdirSync(LEAVES_DIR, { recursive: true });

writeFileSync(join(FIXTURE_DIR, 'claims.json'), `${JSON.stringify(claims, null, 2)}\n`);
writeFileSync(join(FIXTURE_DIR, 'manifest.json'), `${JSON.stringify(manifest, null, 2)}\n`);

const sampleWmi = '1FA';
const sampleLeaf = built.value.leaves.get(sampleWmi);
writeFileSync(
  join(FIXTURE_DIR, 'golden.json'),
  `${JSON.stringify(
    {
      jsonlSha256: built.value.jsonlSha256,
      merkleRoot: built.value.merkleRoot,
      sampleLeafWmi: sampleWmi,
      sampleLeafHash: sampleLeaf?.leafHash ?? '',
    },
    null,
    2,
  )}\n`,
);

for (const [wmi, entry] of built.value.leaves) {
  writeFileSync(join(LEAVES_DIR, `${wmi}.json`), `${entry.leaf}\n`);
  writeFileSync(
    join(LEAVES_DIR, `${wmi}.proof.json`),
    `${JSON.stringify({ leafHash: entry.leafHash, proof: entry.proof }, null, 2)}\n`,
  );
}

process.stdout.write(
  `Wrote ${claims.length} unsigned claims + manifest; jsonlSha256=${built.value.jsonlSha256} merkleRoot=${built.value.merkleRoot}\n`,
);
