import type { Claim } from '@kargain/vincent/protocol';
import { describe, expect, it } from 'vitest';

import {
  VIN_2011,
  VIN_2014,
  VIN_BODY,
  VIN_FUEL,
  VIN_PLANT,
  loadGenesisMiniClaims,
} from './helpers.js';
import { buildDecoderFromClaims, compileEpoch } from './compile-helper.js';

const SCHEMA = 'sha256:8aaae43c9cb200511b2d99298578d2603d6840398062e376c99abeed673e9556';

function buildGenesisDecoder(extraClaims: Claim[] = []) {
  return buildDecoderFromClaims([...loadGenesisMiniClaims(), ...extraClaims]);
}

describe('genesis-mini decoder integration', () => {
  it('selects different bindings for 2011 and 2014 model years', async () => {
    const epoch = compileEpoch(loadGenesisMiniClaims());
    const entry = epoch.leaves.get('1FA');
    expect(entry).toBeDefined();
    if (entry === undefined) {
      return;
    }

    const parsed = JSON.parse(entry.leaf) as {
      bindings: Array<{ yearFrom: number; yearTo: number | null }>;
      schemas: Record<string, unknown>;
    };
    const bindings2011 = parsed.bindings.filter(
      (b) => b.yearFrom <= 2011 && (b.yearTo === null || b.yearTo >= 2011),
    );
    const bindings2014 = parsed.bindings.filter(
      (b) => b.yearFrom <= 2014 && (b.yearTo === null || b.yearTo >= 2014),
    );
    expect(bindings2011).toHaveLength(1);
    expect(bindings2014).toHaveLength(1);
    expect(bindings2011[0].yearFrom).toBe(2010);
    expect(bindings2011[0].yearTo).toBe(2012);
    expect(bindings2014[0].yearFrom).toBe(2013);
    expect(bindings2014[0].yearTo).toBeNull();
    expect(Object.keys(parsed.schemas).length).toBeGreaterThan(0);

    const decoder = buildDecoderFromClaims(loadGenesisMiniClaims());
    const result2011 = await decoder.decode(VIN_2011);
    const result2014 = await decoder.decode(VIN_2014);

    expect(result2011.year.value).toBe(2011);
    expect(result2014.year.value).toBe(2014);
    expect(result2011.attributes.find((attr) => attr.attribute === 'model')?.value).toBe('Fusion');
    expect(result2014.attributes.find((attr) => attr.attribute === 'model')?.value).toBe('Fusion');
  });

  it('decodes bodyType, fuelType, and plant patterns', async () => {
    const decoder = buildGenesisDecoder();
    const body = await decoder.decode(VIN_BODY);
    expect(body.attributes.find((attr) => attr.attribute === 'bodyType')).toEqual(
      expect.objectContaining({ attribute: 'bodyType', value: 'Sedan', ambiguous: false }),
    );
    const fuel = await decoder.decode(VIN_FUEL);
    expect(fuel.attributes.find((attr) => attr.attribute === 'fuelType')).toEqual(
      expect.objectContaining({ attribute: 'fuelType', value: 'Gasoline', ambiguous: false }),
    );
    const plant = await decoder.decode(VIN_PLANT);
    expect(plant.attributes.find((attr) => attr.attribute === 'plant')).toEqual(
      expect.objectContaining({ attribute: 'plant', value: 'Chicago', ambiguous: false }),
    );
  });

  it('never emits the superseded Fusion-OLD model code', async () => {
    const decoder = buildGenesisDecoder();
    const result = await decoder.decode(VIN_2011);
    const model = result.attributes.find((attr) => attr.attribute === 'model');
    expect(model?.value).toBe('Fusion');
    expect(JSON.stringify(result.attributes)).not.toContain('Fusion-OLD');
  });

  it('lists ambiguous model candidates when overlapping patterns survive compile', async () => {
    const overlap: Claim = {
      schemaVersion: '1.1',
      type: 'vds-pattern',
      key: {
        schema: SCHEMA,
        match: { vds: '**B[AB]' },
      },
      value: { attribute: 'model', code: 'Fusion-ALT' },
      provenance: 'regulatory/us-vpic',
      license: 'CC0-1.0',
    };

    const decoder = buildGenesisDecoder([overlap]);
    const result = await decoder.decode(VIN_2011);
    const model = result.attributes.find((attr) => attr.attribute === 'model');
    expect(model?.ambiguous).toBe(true);
    expect(model?.value).toBeNull();
    expect(model?.candidates?.map((candidate) => candidate.value).sort()).toEqual([
      'Fusion',
      'Fusion-ALT',
    ]);
  });
});
