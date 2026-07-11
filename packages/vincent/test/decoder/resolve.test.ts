import { describe, expect, it, vi } from 'vitest';

import * as modelYear from '../../src/model-year.js';
import type { DecodeLeaf, LeafBinding } from '../../src/decoder/leaf-types.js';
import {
  bindingContainsYear,
  collectHitsForBindings,
  collectPatternHits,
  collectTaggedHits,
  decodeFromLeaf,
  mergeHits,
  mergeTaggedHits,
  resolveWmiKey,
} from '../../src/decoder/resolve.js';
import { VIN_2011, VIN_2014, VIN_BODY } from './helpers.js';

const SCHEMA = 'sha256:8aaae43c9cb200511b2d99298578d2603d6840398062e376c99abeed673e9556';

function makeLeaf(config: {
  bindings?: LeafBinding[];
  patterns?: Array<{
    schemaRef: string;
    match: { vds: string; vis?: string };
    attribute: string;
    code: string;
  }>;
}): DecodeLeaf {
  const schemas: DecodeLeaf['schemas'] = {};
  for (const pattern of config.patterns ?? []) {
    const list = schemas[pattern.schemaRef]?.patterns ?? [];
    list.push({
      match: pattern.match,
      attribute: pattern.attribute,
      code: pattern.code,
    });
    schemas[pattern.schemaRef] = { patterns: list };
  }

  return {
    wmi: '1FA',
    bindings: config.bindings ?? [],
    schemas,
  };
}

const wmi = {
  wmi: '1FA',
  manufacturer: 'Ford',
  country: 'US',
  vehicleType: 'Passenger Car',
  region: 'NA',
};

const binding2011: LeafBinding = {
  yearFrom: 2010,
  yearTo: 2012,
  schemaRef: SCHEMA,
};

const binding2014: LeafBinding = {
  yearFrom: 2013,
  yearTo: null,
  schemaRef: SCHEMA,
};

const patterns = [
  {
    schemaRef: SCHEMA,
    match: { vds: '**BB', vis: '*G' },
    attribute: 'model',
    code: 'Fusion',
  },
];

describe('resolveWmiKey', () => {
  it('uses 3-char WMI by default', () => {
    expect(resolveWmiKey('1FA12BBABG1234567')).toBe('1FA');
  });

  it('uses 6-char WMI when position 3 is 9', () => {
    expect(resolveWmiKey('12945678901234567')).toBe('129456');
  });
});

describe('bindingContainsYear', () => {
  it('accepts years inside a closed range', () => {
    expect(bindingContainsYear(binding2011, 2011)).toBe(true);
  });

  it('accepts the upper bound', () => {
    expect(bindingContainsYear(binding2011, 2012)).toBe(true);
  });

  it('rejects years after yearTo', () => {
    expect(bindingContainsYear(binding2011, 2013)).toBe(false);
  });

  it('treats null yearTo as open-ended', () => {
    expect(bindingContainsYear({ ...binding2011, yearTo: null }, 2030)).toBe(true);
  });
});

describe('mergeHits', () => {
  it('merges unambiguous attributes', () => {
    const attrs = mergeHits([
      {
        attribute: 'model',
        code: 'Fusion',
        schemaRef: SCHEMA,
      },
    ]);
    expect(attrs).toEqual([
      {
        attribute: 'model',
        value: 'Fusion',
        ambiguous: false,
        schema: SCHEMA,
      },
    ]);
  });

  it('marks conflicting values as ambiguous', () => {
    const attrs = mergeHits([
      {
        attribute: 'model',
        code: 'Fusion',
        schemaRef: SCHEMA,
      },
      {
        attribute: 'model',
        code: 'Fusion-ALT',
        schemaRef: SCHEMA,
      },
    ]);
    expect(attrs[0].ambiguous).toBe(true);
    expect(attrs[0].value).toBeNull();
    expect(attrs[0].candidates).toHaveLength(2);
  });
});

describe('mergeTaggedHits', () => {
  it('marks cross-year value differences as yearDependent', () => {
    const attrs = mergeTaggedHits(
      [
        {
          year: 2011,
          hit: {
            attribute: 'model',
            code: 'Old',
            schemaRef: SCHEMA,
          },
        },
        {
          year: 2014,
          hit: {
            attribute: 'model',
            code: 'New',
            schemaRef: SCHEMA,
          },
        },
      ],
      [2011, 2014],
    );
    expect(attrs[0].yearDependent).toBe(true);
    expect(attrs[0].ambiguous).toBe(false);
  });

  it('marks same-year conflicts as ambiguous', () => {
    const attrs = mergeTaggedHits(
      [
        {
          year: 2011,
          hit: {
            attribute: 'model',
            code: 'A',
            schemaRef: SCHEMA,
          },
        },
        {
          year: 2011,
          hit: {
            attribute: 'model',
            code: 'B',
            schemaRef: SCHEMA,
          },
        },
      ],
      [2011, 2014],
    );
    expect(attrs[0].ambiguous).toBe(true);
    expect(attrs[0].yearDependent).toBeUndefined();
  });

  it('sorts year-dependent attributes by name', () => {
    const attrs = mergeTaggedHits(
      [
        {
          year: 2011,
          hit: {
            attribute: 'model',
            code: 'Old',
            schemaRef: SCHEMA,
          },
        },
        {
          year: 2014,
          hit: {
            attribute: 'bodyType',
            code: 'Sedan',
            schemaRef: SCHEMA,
          },
        },
      ],
      [2011, 2014],
    );
    expect(attrs.map((attr) => attr.attribute)).toEqual(['bodyType', 'model']);
  });
});

describe('decodeFromLeaf', () => {
  const leaf = makeLeaf({
    bindings: [binding2011, binding2014],
    patterns,
  });

  it('returns validation errors for invalid VINs without guessing attributes', () => {
    const result = decodeFromLeaf(leaf, '!!!', wmi);
    expect(result.valid).toBe(false);
    expect(result.attributes).toEqual([]);
  });

  it('resolves WMI from the decode context', () => {
    const result = decodeFromLeaf(leaf, VIN_2011, wmi, { year: 2011 });
    expect(result.wmi?.manufacturer).toBe('Ford');
  });

  it('returns no attributes when model year stays ambiguous with no candidates', () => {
    const spy = vi.spyOn(modelYear, 'decodeModelYear').mockReturnValue({
      code: 'A',
      candidates: [],
      best: null,
      method: 'invalid',
    });
    const result = decodeFromLeaf(leaf, VIN_2011, wmi);
    expect(result.year.ambiguous).toBe(true);
    expect(result.attributes).toEqual([]);
    spy.mockRestore();
  });

  it('selects patterns through year-scoped bindings', () => {
    const hits2011 = collectHitsForBindings(leaf, VIN_2011, [binding2011]);
    const hits2014 = collectHitsForBindings(leaf, VIN_2014, [binding2014]);
    expect(hits2011[0]?.code).toBe('Fusion');
    expect(hits2014[0]?.code).toBe('Fusion');
    expect(binding2011.schemaRef).toBe(binding2014.schemaRef);
  });

  it('collectPatternHits queries bindings for a model year', () => {
    const hits = collectPatternHits(leaf, VIN_2011, 2011);
    expect(hits[0]?.code).toBe('Fusion');
  });

  it('collectTaggedHits tags pattern hits with candidate years', () => {
    const tagged = collectTaggedHits(leaf, VIN_2011, [2011, 2014]);
    expect(tagged.length).toBeGreaterThan(0);
    expect(tagged[0]?.year).toBe(2011);
  });

  it('deduplicates patterns from duplicate schema bindings', () => {
    const duplicateBinding: LeafBinding = { ...binding2011, schemaRef: SCHEMA };
    const hits = collectHitsForBindings(makeLeaf({ patterns }), VIN_2011, [
      binding2011,
      duplicateBinding,
    ]);
    expect(hits).toHaveLength(1);
  });

  it('decodes across ambiguous model-year candidates when values agree', () => {
    const spy = vi.spyOn(modelYear, 'decodeModelYear').mockReturnValue({
      code: 'A',
      candidates: [2011, 2014],
      best: null,
      method: 'ambiguous',
    });
    const result = decodeFromLeaf(
      makeLeaf({
        bindings: [binding2011, binding2014],
        patterns,
      }),
      VIN_2011,
      wmi,
    );
    expect(result.year.ambiguous).toBe(true);
    expect(result.attributes.find((attr) => attr.attribute === 'model')?.value).toBe('Fusion');
    spy.mockRestore();
  });

  it('deduplicates duplicate candidates when merging ambiguous attributes', () => {
    const attrs = mergeHits([
      {
        attribute: 'model',
        code: 'A',
        schemaRef: SCHEMA,
      },
      {
        attribute: 'model',
        code: 'A',
        schemaRef: SCHEMA,
      },
      {
        attribute: 'model',
        code: 'B',
        schemaRef: SCHEMA,
      },
    ]);
    expect(attrs[0].candidates).toHaveLength(2);
  });

  it('sorts merged attributes by name', () => {
    const attrs = mergeHits([
      {
        attribute: 'model',
        code: 'Fusion',
        schemaRef: SCHEMA,
      },
      {
        attribute: 'bodyType',
        code: 'Sedan',
        schemaRef: SCHEMA,
      },
    ]);
    expect(attrs.map((attr) => attr.attribute)).toEqual(['bodyType', 'model']);
  });

  it('skips bindings whose schema is missing from leaf.schemas', () => {
    const missingSchemaLeaf = makeLeaf({
      bindings: [{ yearFrom: 2010, yearTo: 2012, schemaRef: 'sha256:missing' }],
      patterns,
    });
    const hits = collectPatternHits(missingSchemaLeaf, VIN_2011, 2011);
    expect(hits).toEqual([]);
  });

  it('returns no attributes when patterns do not match', () => {
    const result = decodeFromLeaf(
      makeLeaf({ bindings: [binding2011], patterns }),
      VIN_BODY,
      wmi,
      { year: 2011 },
    );
    expect(result.attributes).toEqual([]);
  });
});
