import { compile } from '@kargain/vincent-compiler';
import type { Claim } from '@kargain/vincent/protocol';
import { signClaim } from '@kargain/vincent/protocol';
import { describe, expect, it } from 'vitest';

import { createDecoder } from '../../src/decoder/create-decoder.js';
import { openDatasetDb } from '../../src/decoder/sqlite-db.js';
import {
  VIN_2011,
  VIN_2014,
  VIN_BODY,
  VIN_FUEL,
  VIN_PLANT,
  loadGenesisMiniClaims,
  TEST_PRIVATE_KEY,
} from './helpers.js';

const SCHEMA = 'sha256:41595169098e35aa01bb60ea9dde790e3c5560136f00095df27bbf1e328c2f09';

async function buildGenesisDecoder(extraClaims: Claim[] = []) {
  const claims = [...loadGenesisMiniClaims(), ...extraClaims];
  const built = await compile(claims, {});
  if (!built.ok) {
    throw new Error(built.error.message);
  }
  return createDecoder(built.value.sqlite);
}

describe('genesis-mini decoder integration', () => {
  it('selects different bindings for 2011 and 2014 model years', async () => {
    const claims = loadGenesisMiniClaims();
    const built = await compile(claims, {});
    expect(built.ok).toBe(true);
    if (!built.ok) {
      return;
    }

    const db = await openDatasetDb(built.value.sqlite);
    const bindings2011 = db.getBindings('1FA', 2011);
    const bindings2014 = db.getBindings('1FA', 2014);
    expect(bindings2011).toHaveLength(1);
    expect(bindings2014).toHaveLength(1);
    expect(bindings2011[0].claimHash).toMatch(/^sha256:/);
    expect(bindings2014[0].claimHash).toMatch(/^sha256:/);
    expect(bindings2011[0].claimHash).not.toBe(bindings2014[0].claimHash);
    expect(bindings2011[0].yearFrom).toBe(2010);
    expect(bindings2011[0].yearTo).toBe(2012);
    expect(bindings2014[0].yearFrom).toBe(2013);
    expect(bindings2014[0].yearTo).toBeNull();

    const decoder = await createDecoder(built.value.sqlite);
    const result2011 = decoder.decode(VIN_2011);
    const result2014 = decoder.decode(VIN_2014);

    expect(result2011.year.value).toBe(2011);
    expect(result2014.year.value).toBe(2014);
    expect(result2011.attributes.find((attr) => attr.attribute === 'model')?.value).toBe('Fusion');
    expect(result2014.attributes.find((attr) => attr.attribute === 'model')?.value).toBe('Fusion');
    db.close();
  });

  it('decodes bodyType, fuelType, and plant patterns', async () => {
    const decoder = await buildGenesisDecoder();
    expect(decoder.decode(VIN_BODY).attributes).toContainEqual(
      expect.objectContaining({ attribute: 'bodyType', value: 'Sedan', ambiguous: false }),
    );
    expect(decoder.decode(VIN_FUEL).attributes).toContainEqual(
      expect.objectContaining({ attribute: 'fuelType', value: 'Gasoline', ambiguous: false }),
    );
    expect(decoder.decode(VIN_PLANT).attributes).toContainEqual(
      expect.objectContaining({ attribute: 'plant', value: 'Chicago', ambiguous: false }),
    );
  });

  it('never emits the superseded Fusion-OLD model code', async () => {
    const decoder = await buildGenesisDecoder();
    const result = decoder.decode(VIN_2011);
    const model = result.attributes.find((attr) => attr.attribute === 'model');
    expect(model?.value).toBe('Fusion');
    expect(JSON.stringify(result.attributes)).not.toContain('Fusion-OLD');
  });

  it('lists ambiguous model candidates when overlapping patterns survive compile', async () => {
    const overlap = signClaim(
      {
        schemaVersion: '1.1',
        type: 'vds-pattern',
        key: {
          schema: SCHEMA,
          match: { vds: '**B[AB]' },
        },
        value: { attribute: 'model', code: 'Fusion-ALT' },
        provenance: 'regulatory/us-vpic',
        license: 'CC0-1.0',
      },
      TEST_PRIVATE_KEY,
    );

    const decoder = await buildGenesisDecoder([overlap]);
    const result = decoder.decode(VIN_2011);
    const model = result.attributes.find((attr) => attr.attribute === 'model');
    expect(model?.ambiguous).toBe(true);
    expect(model?.value).toBeNull();
    expect(model?.candidates?.map((candidate) => candidate.value).sort()).toEqual([
      'Fusion',
      'Fusion-ALT',
    ]);
  });
});
