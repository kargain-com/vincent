/**
 * Dev script: regenerate genesis-mini signed claims and golden jsonlSha256.
 * Run: pnpm --filter @kargain/vincent-compiler build && node compiler/scripts/gen-fixture.mjs
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { claimHash, signClaim } from '@kargain/vincent/protocol';

import { compile } from '../dist/compile.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const FIXTURE_DIR = join(__dirname, '../fixtures/genesis-mini');

const privateKey = '0xac0974bec39a17e36ba4a6b4d238ff944bacb478cab039431e99c5825582831';

const vdsSchemaUnsigned = {
  schemaVersion: '1.1',
  type: 'vds-schema',
  key: { name: 'Genesis mini test schema' },
  value: {},
  provenance: 'regulatory/us-vpic',
  license: 'CC0-1.0',
};

const vdsSchema = signClaim(vdsSchemaUnsigned, privateKey);
const schemaHash = claimHash(vdsSchema);

const unsignedClaims = [
  {
    schemaVersion: '1.0',
    type: 'wmi',
    key: { wmi: '1FA' },
    value: { manufacturer: 'Ford', country: 'US', region: 'NA' },
    provenance: 'regulatory/us-vpic',
    license: 'CC0-1.0',
  },
  vdsSchemaUnsigned,
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
    value: { manufacturer: 'Peugeot', country: 'FR', region: 'EU' },
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

const signed = unsignedClaims.map((claim) => signClaim(claim, privateKey));

const supersededModel = signed.find(
  (c) => c.type === 'vds-pattern' && c.value.code === 'Fusion-OLD',
);
if (supersededModel === undefined) {
  throw new Error('superseded model pattern not found');
}

const successorUnsigned = {
  schemaVersion: '1.1',
  type: 'vds-pattern',
  key: { schema: schemaHash, match: { vds: '**BB', vis: '*G' } },
  value: { attribute: 'model', code: 'Fusion' },
  provenance: 'regulatory/us-vpic',
  license: 'CC0-1.0',
  supersedes: claimHash(supersededModel),
};

const successor = signClaim(successorUnsigned, privateKey);

const claims = [...signed, successor];

const built = await compile(claims, {});
if (!built.ok) {
  throw new Error(built.error.message);
}

mkdirSync(FIXTURE_DIR, { recursive: true });
writeFileSync(join(FIXTURE_DIR, 'claims.json'), `${JSON.stringify(claims, null, 2)}\n`);
writeFileSync(
  join(FIXTURE_DIR, 'golden.json'),
  `${JSON.stringify({ jsonlSha256: built.value.jsonlSha256 }, null, 2)}\n`,
);

process.stdout.write(`Wrote ${claims.length} claims; jsonlSha256=${built.value.jsonlSha256}\n`);
