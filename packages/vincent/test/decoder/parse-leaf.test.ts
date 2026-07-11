import { canonicalize } from '@kargain/vincent/protocol';
import { describe, expect, it } from 'vitest';

import {
  isPartitionManifest,
  parseLeaf,
  parseLeafBytes,
  parseWireLeaf,
} from '../../src/decoder/parse-leaf.js';

const validLeaf = {
  wmi: '1FA',
  bindings: [{ yearFrom: 2010, yearTo: 2012, schemaRef: 'sha256:abc' }],
  schemas: {
    'sha256:abc': {
      patterns: [{ match: { vds: '**BB' }, attribute: 'model', code: 'Fusion' }],
    },
  },
};

describe('parseLeaf', () => {
  it('parses valid self-contained leaves', () => {
    expect(parseLeaf(validLeaf)).toEqual({ ok: true, value: validLeaf });
  });

  it('rejects non-object leaves', () => {
    expect(parseLeaf([]).ok).toBe(false);
    expect(parseLeaf(null).ok).toBe(false);
  });

  it('rejects missing required fields', () => {
    expect(parseLeaf({ wmi: '1FA' }).ok).toBe(false);
    expect(parseLeaf({ wmi: '1FA', bindings: [] }).ok).toBe(false);
    expect(parseLeaf({ wmi: '1FA', bindings: [], schemas: [] }).ok).toBe(false);
  });

  it('rejects unknown binding fields', () => {
    expect(
      parseLeaf({
        wmi: '1FA',
        bindings: [
          {
            yearFrom: 2010,
            yearTo: 2012,
            schemaRef: 'sha256:abc',
            extraField: 'sha256:def',
          },
        ],
        schemas: {},
      }).ok,
    ).toBe(false);
  });

  it('rejects unknown top-level leaf keys', () => {
    expect(parseLeaf({ ...validLeaf, extra: true }).ok).toBe(false);
  });

  it('rejects unknown schema keys', () => {
    expect(
      parseLeaf({
        wmi: '1FA',
        bindings: [],
        schemas: { s: { patterns: [], extra: true } },
      }).ok,
    ).toBe(false);
  });

  it('rejects unknown pattern keys', () => {
    expect(
      parseLeaf({
        wmi: '1FA',
        bindings: [],
        schemas: {
          s: {
            patterns: [{ match: { vds: '**BB' }, attribute: 'model', code: 'Fusion', extra: true }],
          },
        },
      }).ok,
    ).toBe(false);
  });

  it('rejects unknown match keys', () => {
    expect(
      parseLeaf({
        wmi: '1FA',
        bindings: [],
        schemas: {
          s: {
            patterns: [{ match: { vds: '**BB', extra: true }, attribute: 'model', code: 'Fusion' }],
          },
        },
      }).ok,
    ).toBe(false);
  });

  it('rejects invalid bindings', () => {
    expect(parseLeaf({ wmi: '1FA', bindings: [{ yearFrom: 'x' }], schemas: {} }).ok).toBe(false);
    expect(
      parseLeaf({
        wmi: '1FA',
        bindings: [{ yearFrom: 2010, yearTo: null }],
        schemas: {},
      }).ok,
    ).toBe(false);
    expect(parseLeaf({ wmi: '1FA', bindings: [null], schemas: {} }).ok).toBe(false);
  });

  it('rejects invalid patterns', () => {
    expect(
      parseLeaf({
        wmi: '1FA',
        bindings: [],
        schemas: { x: { patterns: [null] } },
      }).ok,
    ).toBe(false);
    expect(
      parseLeaf({
        wmi: '1FA',
        bindings: [],
        schemas: { x: { patterns: [{ match: { vds: 1 }, attribute: 'a', code: 'b' }] } },
      }).ok,
    ).toBe(false);
    expect(parseLeaf({ wmi: '1FA', bindings: [], schemas: { x: null } }).ok).toBe(false);
  });

  it('rejects non-string wmi', () => {
    expect(parseLeaf({ wmi: 1, bindings: [], schemas: {} }).ok).toBe(false);
  });

  it('accepts empty bindings and schemas', () => {
    expect(parseLeaf({ wmi: '1FA', bindings: [], schemas: {} })).toEqual({
      ok: true,
      value: { wmi: '1FA', bindings: [], schemas: {} },
    });
  });

  it('accepts patterns with optional vis', () => {
    const leaf = {
      wmi: '1FA',
      bindings: [],
      schemas: {
        s: {
          patterns: [{ match: { vds: '**BB', vis: '*G' }, attribute: 'model', code: 'Fusion' }],
        },
      },
    };
    expect(parseLeaf(leaf)).toEqual({ ok: true, value: leaf });
  });

  it('rejects patterns missing attribute or code', () => {
    expect(
      parseLeaf({
        wmi: '1FA',
        bindings: [],
        schemas: {
          s: {
            patterns: [{ match: { vds: '**BB' }, attribute: 1, code: 'Fusion' }],
          },
        },
      }).ok,
    ).toBe(false);
    expect(
      parseLeaf({
        wmi: '1FA',
        bindings: [],
        schemas: {
          s: {
            patterns: [{ match: { vds: '**BB' }, attribute: 'model', code: 1 }],
          },
        },
      }).ok,
    ).toBe(false);
  });

  it('rejects invalid yearTo', () => {
    expect(
      parseLeaf({
        wmi: '1FA',
        bindings: [{ yearFrom: 2010, yearTo: 2010.5, schemaRef: 's' }],
        schemas: {},
      }).ok,
    ).toBe(false);
  });

  it('rejects match.vis of wrong type', () => {
    expect(
      parseLeaf({
        wmi: '1FA',
        bindings: [],
        schemas: {
          s: {
            patterns: [{ match: { vds: '**BB', vis: 1 }, attribute: 'model', code: 'Fusion' }],
          },
        },
      }).ok,
    ).toBe(false);
  });

  it('rejects partition manifest shape via parseLeaf', () => {
    expect(
      parseLeaf({
        wmi: '1FA',
        partitioned: true,
        partitions: [],
      }).ok,
    ).toBe(false);
  });

  it('rejects leaf with partitioned flag that is not true', () => {
    expect(
      parseLeaf({
        wmi: '1FA',
        partitioned: false,
        bindings: [],
        schemas: {},
      }).ok,
    ).toBe(false);
  });
});

describe('parseWireLeaf', () => {
  const manifest = {
    wmi: 'JSA',
    partitioned: true,
    partitions: [
      {
        yearFrom: 2010,
        yearTo: 2015,
        key: 'JSA#p0',
        leafHash: 'sha256:abc',
      },
    ],
  };

  it('parses partition manifests', () => {
    const parsed = parseWireLeaf(manifest);
    expect(parsed.ok).toBe(true);
    if (parsed.ok) {
      expect(isPartitionManifest(parsed.value)).toBe(true);
    }
  });

  it('delegates to parseLeaf for normal leaves', () => {
    expect(parseWireLeaf(validLeaf)).toEqual(parseLeaf(validLeaf));
  });

  it('rejects manifests with bindings or schemas', () => {
    expect(parseWireLeaf({ ...manifest, bindings: [] }).ok).toBe(false);
    expect(parseWireLeaf({ ...manifest, schemas: {} }).ok).toBe(false);
  });

  it('rejects unknown manifest keys', () => {
    expect(parseWireLeaf({ ...manifest, extra: true }).ok).toBe(false);
  });

  it('rejects unknown partition entry keys', () => {
    expect(
      parseWireLeaf({
        ...manifest,
        partitions: [{ ...manifest.partitions[0], extra: true }],
      }).ok,
    ).toBe(false);
  });

  it('rejects invalid partition entries', () => {
    expect(parseWireLeaf({ ...manifest, partitions: [{}] }).ok).toBe(false);
    expect(parseWireLeaf({ ...manifest, partitions: null }).ok).toBe(false);
  });

  it('rejects partitioned flag that is not true', () => {
    expect(parseWireLeaf({ wmi: '1FA', partitioned: false, bindings: [], schemas: {} }).ok).toBe(
      false,
    );
  });
});

describe('parseLeafBytes', () => {
  it('parses string and Uint8Array content', () => {
    const canonical = canonicalize(validLeaf);
    expect(parseLeafBytes(canonical).ok).toBe(true);
    expect(parseLeafBytes(new TextEncoder().encode(canonical)).ok).toBe(true);
  });

  it('rejects invalid JSON', () => {
    expect(parseLeafBytes('{bad').ok).toBe(false);
  });
});
