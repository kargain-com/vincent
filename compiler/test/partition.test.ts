import type { Claim } from '@kargain/vincent/protocol';
import { describe, expect, it } from 'vitest';

import { compile } from '../src/compile.js';
import { LEAF_CAP_BYTES, buildLeaves, collectBoundarySegments } from '../src/leaves.js';
import type { LeafBinding } from '../src/leaves.js';

const PROVENANCE = 'regulatory/us-vpic' as const;
const LICENSE = 'CC0-1.0' as const;

function schemaRef(index: number): string {
  const hex = index.toString(16).padStart(64, '0');
  return `sha256:${hex}`;
}

/** One schema + patterns per year so sub-leaves stay under cap when split by year range. */
function buildOversizedWmiClaims(wmi: string, patternsPerSchema: number, yearCount: number): Claim[] {
  const startYear = 2000;
  const claims: Claim[] = [
    {
      schemaVersion: '1.0',
      type: 'wmi',
      key: { wmi },
      value: {
        manufacturer: 'Partition Test Motors',
        country: 'US',
        vehicleType: 'Passenger Car',
        region: 'NA',
      },
      provenance: PROVENANCE,
      license: LICENSE,
    },
  ];

  for (let offset = 0; offset < yearCount; offset++) {
    const schemaIndex = offset;
    claims.push({
      schemaVersion: '1.1',
      type: 'vds-schema',
      key: { name: `partition schema ${wmi}-${String(schemaIndex)}` },
      value: {},
      provenance: PROVENANCE,
      license: LICENSE,
    });

    const year = startYear + offset;
    claims.push({
      schemaVersion: '1.1',
      type: 'vds-binding',
      key: {
        wmi,
        yearFrom: year,
        yearTo: year,
        schema: schemaRef(schemaIndex),
      },
      value: {},
      provenance: PROVENANCE,
      license: LICENSE,
    });

    for (let patternIndex = 0; patternIndex < patternsPerSchema; patternIndex++) {
      const suffix = patternIndex.toString(16).padStart(2, '0').toUpperCase();
      claims.push({
        schemaVersion: '1.1',
        type: 'vds-pattern',
        key: {
          schema: schemaRef(schemaIndex),
          match: { vds: `**${suffix}` },
        },
        value: {
          attribute: 'model',
          code: `Y${String(year)}-M${String(patternIndex).padStart(3, '0')}`,
        },
        provenance: PROVENANCE,
        license: LICENSE,
      });
    }
  }

  claims.push({
    schemaVersion: '1.1',
    type: 'vds-binding',
    key: {
      wmi,
      yearFrom: startYear + yearCount,
      yearTo: null,
      schema: schemaRef(yearCount - 1),
    },
    value: {},
    provenance: PROVENANCE,
    license: LICENSE,
  });

  return claims;
}

describe('year-range leaf partitioning', () => {
  const WMI = 'ZZZ';
  const CAP = 4096;
  const claims = buildOversizedWmiClaims(WMI, 12, 24);

  it('partitions oversized WMIs into manifest + sub-leaves under cap', () => {
    const { leaves } = buildLeaves(claims, { leafCapBytes: CAP });

    const manifest = leaves.get(WMI);
    expect(manifest).toBeDefined();
    const parsedManifest = JSON.parse(manifest!.canonical) as {
      wmi: string;
      partitioned: boolean;
      partitions: Array<{ yearFrom: number; yearTo: number | null; key: string; leafHash: string }>;
    };
    expect(parsedManifest.partitioned).toBe(true);
    expect(parsedManifest.partitions.length).toBeGreaterThan(1);

    for (const partition of parsedManifest.partitions) {
      expect(partition.key.startsWith(`${WMI}#p`)).toBe(true);
      expect(partition.leafHash).toBe(leaves.get(partition.key)?.leafHash);

      const subLeaf = leaves.get(partition.key);
      expect(subLeaf).toBeDefined();
      expect(Buffer.byteLength(subLeaf!.canonical, 'utf8')).toBeLessThanOrEqual(CAP);

      const parsedSub = JSON.parse(subLeaf!.canonical) as { wmi: string; bindings: unknown[] };
      expect(parsedSub.wmi).toBe(WMI);
      expect(parsedSub.bindings.length).toBeGreaterThan(0);
    }

    expect(Buffer.byteLength(manifest!.canonical, 'utf8')).toBeLessThan(CAP);
  });

  it('keeps unpartitioned WMIs at the base key when under cap', () => {
    const small = buildOversizedWmiClaims('AAA', 2, 2);
    const { leaves } = buildLeaves(small, { leafCapBytes: CAP });
    expect(leaves.has('AAA')).toBe(true);
    expect([...leaves.keys()].some((key) => key.startsWith('AAA#p'))).toBe(false);
    const parsed = JSON.parse(leaves.get('AAA')!.canonical) as { partitioned?: boolean };
    expect(parsed.partitioned).toBeUndefined();
  });

  it('ends with open-ended partition when bindings include yearTo null', () => {
    const { leaves } = buildLeaves(claims, { leafCapBytes: CAP });
    const manifest = JSON.parse(leaves.get(WMI)!.canonical) as {
      partitions: Array<{ yearTo: number | null }>;
    };
    expect(manifest.partitions.at(-1)?.yearTo).toBeNull();
  });

  it('is deterministic across two builds', () => {
    const first = buildLeaves(claims, { leafCapBytes: CAP });
    const second = buildLeaves(claims, { leafCapBytes: CAP });
    expect(first.leaves.size).toBe(second.leaves.size);
    for (const [key, entry] of first.leaves) {
      expect(second.leaves.get(key)?.canonical).toBe(entry.canonical);
      expect(second.leaves.get(key)?.leafHash).toBe(entry.leafHash);
    }
  });

  it('defaults to LEAF_CAP_BYTES', () => {
    expect(LEAF_CAP_BYTES).toBe(128 * 1024);
  });

  it('integrates with compile via leafCapBytes policy', () => {
    const result = compile(claims, { leafCapBytes: CAP });
    expect(result.ok).toBe(true);
    if (!result.ok) {
      return;
    }
    expect(result.value.leaves.has(WMI)).toBe(true);
    expect([...result.value.leaves.keys()].some((key) => key.startsWith(`${WMI}#p`))).toBe(true);
  });

  it('splits patterns within a single year when one schema exceeds cap', () => {
    const wmi = 'YYY';
    const schema = 'sha256:2222222222222222222222222222222222222222222222222222222222222222';
    const fatClaims: Claim[] = [
      {
        schemaVersion: '1.0',
        type: 'wmi',
        key: { wmi },
        value: {
          manufacturer: 'Fat Year Motors',
          country: 'US',
          vehicleType: 'Passenger Car',
          region: 'NA',
        },
        provenance: PROVENANCE,
        license: LICENSE,
      },
      {
        schemaVersion: '1.1',
        type: 'vds-schema',
        key: { name: 'fat year schema' },
        value: {},
        provenance: PROVENANCE,
        license: LICENSE,
      },
      {
        schemaVersion: '1.1',
        type: 'vds-binding',
        key: { wmi, yearFrom: 1999, yearTo: 1999, schema },
        value: {},
        provenance: PROVENANCE,
        license: LICENSE,
      },
    ];
    for (let index = 0; index < 120; index++) {
      const suffix = index.toString(16).padStart(2, '0').toUpperCase();
      fatClaims.push({
        schemaVersion: '1.1',
        type: 'vds-pattern',
        key: { schema, match: { vds: `**${suffix}` } },
        value: { attribute: 'model', code: `Fat-${String(index).padStart(4, '0')}` },
        provenance: PROVENANCE,
        license: LICENSE,
      });
    }

    const { leaves } = buildLeaves(fatClaims, { leafCapBytes: CAP });
    const manifest = JSON.parse(leaves.get(wmi)!.canonical) as {
      partitions: Array<{ yearFrom: number; yearTo: number | null; key: string }>;
    };
    const sameYearParts = manifest.partitions.filter(
      (partition) => partition.yearFrom === 1999 && partition.yearTo === 1999,
    );
    expect(sameYearParts.length).toBeGreaterThan(1);
    for (const partition of manifest.partitions) {
      const subLeaf = leaves.get(partition.key);
      expect(Buffer.byteLength(subLeaf!.canonical, 'utf8')).toBeLessThanOrEqual(CAP);
    }
  });

  it('collectBoundarySegments skips empty gaps and handles open-ended tail', () => {
    const bindings: LeafBinding[] = [
      { yearFrom: 2010, yearTo: 2012, schemaRef: 'sha256:a' },
      { yearFrom: 2015, yearTo: 2018, schemaRef: 'sha256:b' },
      { yearFrom: 2020, yearTo: null, schemaRef: 'sha256:c' },
    ];
    expect(collectBoundarySegments(bindings)).toEqual([
      { yearFrom: 2010, yearTo: 2012 },
      { yearFrom: 2015, yearTo: 2018 },
      { yearFrom: 2020, yearTo: null },
    ]);
  });

  it('partitions wide year spans without enumerating every year', () => {
    const wmi = 'WWW';
    const schema = 'sha256:3333333333333333333333333333333333333333333333333333333333333333';
    const wideClaims: Claim[] = [
      {
        schemaVersion: '1.0',
        type: 'wmi',
        key: { wmi },
        value: {
          manufacturer: 'Wide Span Motors',
          country: 'US',
          vehicleType: 'Passenger Car',
          region: 'NA',
        },
        provenance: PROVENANCE,
        license: LICENSE,
      },
      {
        schemaVersion: '1.1',
        type: 'vds-schema',
        key: { name: 'wide span schema' },
        value: {},
        provenance: PROVENANCE,
        license: LICENSE,
      },
      {
        schemaVersion: '1.1',
        type: 'vds-binding',
        key: { wmi, yearFrom: 2000, yearTo: 999_999, schema },
        value: {},
        provenance: PROVENANCE,
        license: LICENSE,
      },
    ];
    for (let index = 0; index < 120; index++) {
      const suffix = index.toString(16).padStart(2, '0').toUpperCase();
      wideClaims.push({
        schemaVersion: '1.1',
        type: 'vds-pattern',
        key: { schema, match: { vds: `**${suffix}` } },
        value: { attribute: 'model', code: `Wide-${String(index).padStart(3, '0')}` },
        provenance: PROVENANCE,
        license: LICENSE,
      });
    }

    const start = performance.now();
    const { leaves } = buildLeaves(wideClaims, { leafCapBytes: CAP });
    expect(performance.now() - start).toBeLessThan(2000);
    const parsed = JSON.parse(leaves.get(wmi)!.canonical) as { partitioned?: boolean };
    expect(parsed.partitioned).toBe(true);
  });

  it('reports progress while building leaves', () => {
    const messages: string[] = [];
    const multiWmiClaims = [
      ...buildOversizedWmiClaims('ZZ1', 2, 2),
      ...buildOversizedWmiClaims('ZZ2', 2, 2).filter((claim) => claim.type !== 'wmi'),
      {
        schemaVersion: '1.0',
        type: 'wmi',
        key: { wmi: 'ZZ2' },
        value: {
          manufacturer: 'ZZ2 Motors',
          country: 'US',
          vehicleType: 'Passenger Car',
          region: 'NA',
        },
        provenance: PROVENANCE,
        license: LICENSE,
      },
    ];
    buildLeaves(multiWmiClaims, {
      leafCapBytes: CAP,
      progress: (message) => {
        messages.push(message);
      },
    });
    expect(messages.some((message) => message.includes('Building leaves:'))).toBe(true);
  });
});
