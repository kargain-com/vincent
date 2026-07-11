import { describe, expect, it, vi } from 'vitest';

import type { BindingRow, DatasetDb, PatternRow, WmiRow } from '../../src/decoder/dataset-db.js';
import * as modelYear from '../../src/model-year.js';
import {
  bindingContainsYear,
  collectHitsForBindings,
  collectPatternHits,
  collectTaggedHits,
  decodeFromDataset,
  mergeHits,
  mergeTaggedHits,
  resolveWmiKey,
} from '../../src/decoder/resolve.js';
import { VIN_2011, VIN_2014, VIN_BODY } from './helpers.js';

const SCHEMA = 'sha256:41595169098e35aa01bb60ea9dde790e3c5560136f00095df27bbf1e328c2f09';

function makeDb(config: {
  wmi?: WmiRow | null;
  bindings?: BindingRow[];
  patterns?: PatternRow[];
}): DatasetDb {
  return {
    getWmi: () => config.wmi ?? null,
    getBindings: (_wmi, year) =>
      (config.bindings ?? []).filter((binding) => bindingContainsYear(binding, year)),
    getPatterns: (schemaHash) =>
      (config.patterns ?? []).filter((pattern) => pattern.schemaHash === schemaHash),
  };
}

describe('resolveWmiKey', () => {
  it('uses 3-char WMI by default', () => {
    expect(resolveWmiKey('1FA12BBABG1234567')).toBe('1FA');
  });

  it('uses 6-char WMI when position 3 is 9', () => {
    expect(resolveWmiKey('12945678901234567')).toBe('129456');
  });
});

describe('bindingContainsYear', () => {
  const binding: BindingRow = {
    claimHash: 'sha256:a',
    wmi: '1FA',
    yearFrom: 2010,
    yearTo: 2012,
    schemaHash: SCHEMA,
  };

  it('accepts years inside a closed range', () => {
    expect(bindingContainsYear(binding, 2011)).toBe(true);
  });

  it('accepts the upper bound', () => {
    expect(bindingContainsYear(binding, 2012)).toBe(true);
  });

  it('rejects years after yearTo', () => {
    expect(bindingContainsYear(binding, 2013)).toBe(false);
  });

  it('treats null yearTo as open-ended', () => {
    expect(bindingContainsYear({ ...binding, yearTo: null }, 2030)).toBe(true);
  });
});

describe('mergeHits', () => {
  it('merges unambiguous attributes', () => {
    const attrs = mergeHits([
      {
        attribute: 'model',
        code: 'Fusion',
        schemaHash: SCHEMA,
        claimHash: 'sha256:1',
      },
    ]);
    expect(attrs).toEqual([
      {
        attribute: 'model',
        value: 'Fusion',
        ambiguous: false,
        schema: SCHEMA,
        sourceClaimHash: 'sha256:1',
      },
    ]);
  });

  it('marks conflicting values as ambiguous', () => {
    const attrs = mergeHits([
      {
        attribute: 'model',
        code: 'Fusion',
        schemaHash: SCHEMA,
        claimHash: 'sha256:1',
      },
      {
        attribute: 'model',
        code: 'Fusion-ALT',
        schemaHash: SCHEMA,
        claimHash: 'sha256:2',
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
            schemaHash: SCHEMA,
            claimHash: 'sha256:1',
          },
        },
        {
          year: 2014,
          hit: {
            attribute: 'model',
            code: 'New',
            schemaHash: SCHEMA,
            claimHash: 'sha256:2',
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
            schemaHash: SCHEMA,
            claimHash: 'sha256:1',
          },
        },
        {
          year: 2011,
          hit: {
            attribute: 'model',
            code: 'B',
            schemaHash: SCHEMA,
            claimHash: 'sha256:2',
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
            schemaHash: SCHEMA,
            claimHash: 'sha256:1',
          },
        },
        {
          year: 2014,
          hit: {
            attribute: 'bodyType',
            code: 'Sedan',
            schemaHash: SCHEMA,
            claimHash: 'sha256:2',
          },
        },
      ],
      [2011, 2014],
    );
    expect(attrs.map((attr) => attr.attribute)).toEqual(['bodyType', 'model']);
  });
});

describe('decodeFromDataset', () => {
  const wmi: WmiRow = {
    wmi: '1FA',
    manufacturer: 'Ford',
    country: 'US',
    region: 'NA',
    claimHash: 'sha256:wmi',
  };

  const binding2011: BindingRow = {
    claimHash: 'sha256:bind2011',
    wmi: '1FA',
    yearFrom: 2010,
    yearTo: 2012,
    schemaHash: SCHEMA,
  };

  const binding2014: BindingRow = {
    claimHash: 'sha256:bind2014',
    wmi: '1FA',
    yearFrom: 2013,
    yearTo: null,
    schemaHash: SCHEMA,
  };

  const patterns: PatternRow[] = [
    {
      claimHash: 'sha256:model',
      schemaHash: SCHEMA,
      matchVds: '**BB',
      matchVis: '*G',
      attribute: 'model',
      code: 'Fusion',
    },
  ];

  it('returns validation errors for invalid VINs without guessing attributes', () => {
    const result = decodeFromDataset(makeDb({ wmi }), '!!!');
    expect(result.valid).toBe(false);
    expect(result.wmi).toBeNull();
    expect(result.attributes).toEqual([]);
  });

  it('resolves WMI from the dataset', () => {
    const result = decodeFromDataset(makeDb({ wmi, bindings: [binding2011], patterns }), VIN_2011, {
      year: 2011,
    });
    expect(result.wmi?.manufacturer).toBe('Ford');
  });

  it('returns early when WMI is absent from the dataset', () => {
    const result = decodeFromDataset(makeDb({ wmi: null }), VIN_2011, { year: 2011 });
    expect(result.wmi).toBeNull();
    expect(result.attributes).toEqual([]);
  });

  it('returns early for VINs shorter than three characters', () => {
    const result = decodeFromDataset(makeDb({ wmi }), '1F', { year: 2011 });
    expect(result.wmi).toBeNull();
    expect(result.attributes).toEqual([]);
  });

  it('returns no attributes when model year stays ambiguous with no candidates', () => {
    const spy = vi.spyOn(modelYear, 'decodeModelYear').mockReturnValue({
      code: 'A',
      candidates: [],
      best: null,
      method: 'invalid',
    });
    const result = decodeFromDataset(makeDb({ wmi, bindings: [binding2011], patterns }), VIN_2011);
    expect(result.year.ambiguous).toBe(true);
    expect(result.attributes).toEqual([]);
    spy.mockRestore();
  });

  it('selects patterns through year-scoped bindings', () => {
    const db = makeDb({ wmi, bindings: [binding2011, binding2014], patterns });
    const hits2011 = collectHitsForBindings(db, VIN_2011, [binding2011]);
    const hits2014 = collectHitsForBindings(db, VIN_2014, [binding2014]);
    expect(hits2011[0]?.code).toBe('Fusion');
    expect(hits2014[0]?.code).toBe('Fusion');
    expect(binding2011.claimHash).not.toBe(binding2014.claimHash);
  });

  it('collectPatternHits queries bindings for a model year', () => {
    const hits = collectPatternHits(
      makeDb({ bindings: [binding2011], patterns }),
      '1FA',
      VIN_2011,
      2011,
    );
    expect(hits[0]?.code).toBe('Fusion');
  });

  it('collectTaggedHits tags pattern hits with candidate years', () => {
    const tagged = collectTaggedHits(
      makeDb({ bindings: [binding2011, binding2014], patterns }),
      '1FA',
      VIN_2011,
      [2011, 2014],
    );
    expect(tagged.length).toBeGreaterThan(0);
    expect(tagged[0]?.year).toBe(2011);
  });

  it('deduplicates patterns from duplicate schema bindings', () => {
    const duplicateBinding: BindingRow = { ...binding2011, claimHash: 'sha256:dup' };
    const hits = collectHitsForBindings(makeDb({ patterns }), VIN_2011, [
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
    const result = decodeFromDataset(
      makeDb({
        wmi,
        bindings: [binding2011, binding2014],
        patterns,
      }),
      VIN_2011,
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
        schemaHash: SCHEMA,
        claimHash: 'sha256:1',
      },
      {
        attribute: 'model',
        code: 'A',
        schemaHash: SCHEMA,
        claimHash: 'sha256:1',
      },
      {
        attribute: 'model',
        code: 'B',
        schemaHash: SCHEMA,
        claimHash: 'sha256:2',
      },
    ]);
    expect(attrs[0].candidates).toHaveLength(2);
  });

  it('sorts merged attributes by name', () => {
    const attrs = mergeHits([
      {
        attribute: 'model',
        code: 'Fusion',
        schemaHash: SCHEMA,
        claimHash: 'sha256:1',
      },
      {
        attribute: 'bodyType',
        code: 'Sedan',
        schemaHash: SCHEMA,
        claimHash: 'sha256:2',
      },
    ]);
    expect(attrs.map((attr) => attr.attribute)).toEqual(['bodyType', 'model']);
  });

  it('returns no attributes when patterns do not match', () => {
    const result = decodeFromDataset(
      makeDb({ wmi, bindings: [binding2011], patterns }),
      VIN_BODY,
      { year: 2011 },
    );
    expect(result.attributes).toEqual([]);
  });
});
