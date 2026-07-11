import { buildMerkle } from '@kargain/vincent-compiler';
import type { EpochBuild, EpochLeaf } from '@kargain/vincent-compiler';
import { canonicalize, sha256Hex } from '@kargain/vincent/protocol';
import { describe, expect, it, vi } from 'vitest';

import * as modelYearModule from '../../src/model-year.js';
import { createDecoder } from '../../src/decoder/create-decoder.js';
import { parseWireLeaf } from '../../src/decoder/parse-leaf.js';
import { verifyLeaf } from '../../src/decoder/verify-leaf.js';
import { compileEpoch } from './compile-helper.js';
import { VIN_2011 } from './helpers.js';
import { buildPartitioned1FaClaims } from './partition-claims.js';

const CAP = 4096;

function leafHashFor(canonical: string): string {
  return `sha256:${sha256Hex(new TextEncoder().encode(canonical))}`;
}

function replaceLeaf(epoch: EpochBuild, key: string, leaf: string): EpochBuild {
  const leafHash = leafHashFor(leaf);
  const leaves = new Map(epoch.leaves);
  const existing = leaves.get(key);
  if (existing === undefined) {
    throw new Error(`missing leaf ${key}`);
  }
  leaves.set(key, { ...existing, leaf, leafHash });
  const ordered = [...leaves.entries()].sort(([a], [b]) => a.localeCompare(b));
  const digests = ordered.map(([, entry]) => entry.leafHash);
  const tree = buildMerkle(digests);
  const rebuilt = new Map<string, EpochLeaf>();
  for (let index = 0; index < ordered.length; index++) {
    const [leafKey, entry] = ordered[index];
    rebuilt.set(leafKey, {
      leaf: entry.leaf,
      leafHash: entry.leafHash,
      proof: tree.proofFor(index),
    });
  }
  return { ...epoch, merkleRoot: tree.root, leaves: rebuilt };
}

function buildPartitionEpoch(): EpochBuild {
  return compileEpoch(buildPartitioned1FaClaims(12, 24), { leafCapBytes: CAP });
}

function decoderFromEpoch(epoch: EpochBuild) {
  return createDecoder({
    merkleRoot: epoch.merkleRoot,
    getLeaf: (leafKey) => {
      const entry = epoch.leaves.get(leafKey);
      if (entry === undefined) {
        return Promise.reject(new Error(`missing leaf for ${leafKey}`));
      }
      return Promise.resolve({ leaf: entry.leaf, proof: entry.proof });
    },
  });
}

describe('partitioned decoder coverage', () => {
  it('caches verified sub-leaves across decode calls', async () => {
    const epoch = buildPartitionEpoch();
    let subFetches = 0;
    const manifest = JSON.parse(epoch.leaves.get('1FA')!.leaf) as {
      partitions: Array<{ key: string }>;
    };
    const subKey = manifest.partitions[0].key;
    const decoder = createDecoder({
      merkleRoot: epoch.merkleRoot,
      getLeaf: (leafKey) => {
        if (leafKey === subKey) {
          subFetches += 1;
        }
        const entry = epoch.leaves.get(leafKey);
        if (entry === undefined) {
          return Promise.reject(new Error(`missing leaf for ${leafKey}`));
        }
        return Promise.resolve({ leaf: entry.leaf, proof: entry.proof });
      },
    });
    await decoder.decode(VIN_2011, { year: 2011 });
    await decoder.decode(VIN_2011, { year: 2011 });
    expect(subFetches).toBe(1);
  });

  it('reports partition-leaf-hash-mismatch when manifest hash does not bind sub-leaf', async () => {
    const epoch = buildPartitionEpoch();
    const manifest = JSON.parse(epoch.leaves.get('1FA')!.leaf) as {
      partitions: Array<{ key: string; leafHash: string }>;
    };
    manifest.partitions[0].leafHash =
      'sha256:0000000000000000000000000000000000000000000000000000000000000000';
    const tamperedEpoch = replaceLeaf(epoch, '1FA', canonicalize(manifest));
    const decoder = decoderFromEpoch(tamperedEpoch);
    const result = await decoder.decode(VIN_2011, { year: 2011 });
    expect(result.errors.some((err) => err.code === 'partition-leaf-hash-mismatch')).toBe(true);
  });

  it('reports invalid-leaf when sub-leaf wmi does not match decode key', async () => {
    const epoch = buildPartitionEpoch();
    const manifest = JSON.parse(epoch.leaves.get('1FA')!.leaf) as {
      partitions: Array<{ key: string; leafHash: string }>;
    };
    const partKey = manifest.partitions[0].key;
    const sub = JSON.parse(epoch.leaves.get(partKey)!.leaf) as { wmi: string };
    sub.wmi = 'VF3';
    const badSub = canonicalize(sub);
    let epoch2 = replaceLeaf(epoch, partKey, badSub);
    manifest.partitions[0].leafHash = leafHashFor(badSub);
    epoch2 = replaceLeaf(epoch2, '1FA', canonicalize(manifest));
    const decoder = decoderFromEpoch(epoch2);
    const result = await decoder.decode(VIN_2011, { year: 2011 });
    expect(result.errors.some((err) => err.code === 'invalid-leaf')).toBe(true);
  });

  it('reports invalid-leaf when a partition key returns a manifest', async () => {
    const epoch = buildPartitionEpoch();
    const manifest = JSON.parse(epoch.leaves.get('1FA')!.leaf) as {
      partitions: Array<{ key: string }>;
    };
    const partKey = manifest.partitions[0].key;
    const decoder = createDecoder({
      merkleRoot: epoch.merkleRoot,
      getLeaf: (leafKey) => {
        if (leafKey === partKey) {
          const entry = epoch.leaves.get('1FA');
          if (entry === undefined) {
            return Promise.reject(new Error('missing manifest'));
          }
          return Promise.resolve({ leaf: entry.leaf, proof: entry.proof });
        }
        const entry = epoch.leaves.get(leafKey);
        if (entry === undefined) {
          return Promise.reject(new Error(`missing leaf for ${leafKey}`));
        }
        return Promise.resolve({ leaf: entry.leaf, proof: entry.proof });
      },
    });
    const result = await decoder.decode(VIN_2011, { year: 2011 });
    expect(result.errors.some((err) => err.code === 'invalid-leaf')).toBe(true);
  });

  it('merges multiple partitions for ambiguous model-year candidates', async () => {
    const epoch = buildPartitionEpoch();
    const decoder = decoderFromEpoch(epoch);
    const spy = vi.spyOn(modelYearModule, 'decodeModelYear').mockReturnValue({
      best: null,
      candidates: [2011, 2025],
      method: 'ambiguous',
    });
    const result = await decoder.decode(VIN_2011);
    spy.mockRestore();
    expect(result.errors).toEqual([]);
    expect(result.year.ambiguous).toBe(true);
  });

  it('returns base when ambiguous decode has no model-year candidates on partitioned WMI', async () => {
    const epoch = buildPartitionEpoch();
    const decoder = decoderFromEpoch(epoch);
    const spy = vi.spyOn(modelYearModule, 'decodeModelYear').mockReturnValue({
      best: null,
      candidates: [],
      method: 'ambiguous',
    });
    const result = await decoder.decode(VIN_2011);
    spy.mockRestore();
    expect(result.attributes).toEqual([]);
    expect(result.errors).toEqual([]);
  });

  it('deduplicates duplicate partition keys when selecting by candidates', async () => {
    const epoch = buildPartitionEpoch();
    const manifest = JSON.parse(epoch.leaves.get('1FA')!.leaf) as {
      partitions: Array<{ yearFrom: number; yearTo: number | null; key: string; leafHash: string }>;
    };
    manifest.partitions = [manifest.partitions[0], manifest.partitions[0]];
    const tamperedEpoch = replaceLeaf(epoch, '1FA', canonicalize(manifest));
    const decoder = decoderFromEpoch(tamperedEpoch);
    const spy = vi.spyOn(modelYearModule, 'decodeModelYear').mockReturnValue({
      best: null,
      candidates: [2011],
      method: 'ambiguous',
    });
    const result = await decoder.decode(VIN_2011);
    spy.mockRestore();
    expect(result.errors).toEqual([]);
  });

  it('skips years after a finite partition upper bound', async () => {
    const epoch = buildPartitionEpoch();
    const manifest = JSON.parse(epoch.leaves.get('1FA')!.leaf) as {
      partitions: Array<{ yearFrom: number; yearTo: number | null; key: string; leafHash: string }>;
    };
    const onlyFinite = manifest.partitions.find((partition) => partition.yearTo !== null);
    expect(onlyFinite).toBeDefined();
    if (onlyFinite === undefined) {
      return;
    }
    const narrowed = {
      wmi: '1FA',
      partitioned: true as const,
      partitions: [onlyFinite],
    };
    const tampered = replaceLeaf(epoch, '1FA', canonicalize(narrowed));
    const decoder = decoderFromEpoch(tampered);
    const result = await decoder.decode(VIN_2011, { year: onlyFinite.yearTo! + 1 });
    expect(result.attributes).toEqual([]);
    expect(result.errors).toEqual([]);
  });

  it('sorts merged patterns by attribute and code tie-breakers', async () => {
    const epoch = buildPartitionEpoch();
    const manifest = JSON.parse(epoch.leaves.get('1FA')!.leaf) as {
      partitions: Array<{ key: string; leafHash: string }>;
    };
    const partA = manifest.partitions[0].key;
    const subA = JSON.parse(epoch.leaves.get(partA)!.leaf) as {
      bindings: Array<{ yearFrom: number; yearTo: number | null; schemaRef: string }>;
      schemas: Record<
        string,
        {
          patterns: Array<{
            match: { vds: string; vis?: string };
            attribute: string;
            code: string;
          }>;
        }
      >;
    };
    const schemaRef = Object.keys(subA.schemas)[0];
    subA.bindings.push(
      { yearFrom: 2010, yearTo: null, schemaRef: `${schemaRef}-open-a` },
      { yearFrom: 2010, yearTo: 2012, schemaRef: `${schemaRef}-finite-b` },
      { yearFrom: 2010, yearTo: null, schemaRef: `${schemaRef}-open-b` },
    );
    subA.schemas[`${schemaRef}-open-a`] = { patterns: [] };
    subA.schemas[`${schemaRef}-finite-b`] = { patterns: [] };
    subA.schemas[`${schemaRef}-open-b`] = { patterns: [] };
    subA.schemas[schemaRef].patterns.push(
      {
        match: { vds: 'ZZZ', vis: 'B' },
        attribute: 'model',
        code: 'shared-code',
      },
      {
        match: { vds: 'ZZZ', vis: 'A' },
        attribute: 'model',
        code: 'shared-code',
      },
      {
        match: { vds: 'ZZZ' },
        attribute: 'zzz-attr',
        code: 'shared-code',
      },
      {
        match: { vds: 'ZZZ' },
        attribute: 'aaa-attr',
        code: 'shared-code',
      },
      {
        match: { vds: 'ZZZ' },
        attribute: 'shared-attr',
        code: 'z-code',
      },
      {
        match: { vds: 'ZZZ' },
        attribute: 'shared-attr',
        code: 'a-code',
      },
    );
    let tampered = replaceLeaf(epoch, partA, canonicalize(subA));
    const updatedManifest = JSON.parse(tampered.leaves.get('1FA')!.leaf) as typeof manifest;
    updatedManifest.partitions[0].leafHash = leafHashFor(tampered.leaves.get(partA)!.leaf);
    tampered = replaceLeaf(tampered, '1FA', canonicalize(updatedManifest));
    const decoder = decoderFromEpoch(tampered);
    const result = await decoder.decode(VIN_2011, { year: 2011 });
    expect(result.errors).toEqual([]);
  });

  it('reports partition-not-found for non-Error fetch rejections', async () => {
    const epoch = buildPartitionEpoch();
    const manifest = JSON.parse(epoch.leaves.get('1FA')!.leaf) as {
      partitions: Array<{ key: string }>;
    };
    const missingKey = manifest.partitions[0].key;
    const decoder = createDecoder({
      merkleRoot: epoch.merkleRoot,
      getLeaf: (leafKey) => {
        if (leafKey === missingKey) {
          // eslint-disable-next-line @typescript-eslint/prefer-promise-reject-errors -- cover non-Error catch path
          return Promise.reject('missing partition');
        }
        const entry = epoch.leaves.get(leafKey);
        if (entry === undefined) {
          return Promise.reject(new Error(`missing leaf for ${leafKey}`));
        }
        return Promise.resolve({ leaf: entry.leaf, proof: entry.proof });
      },
    });
    const result = await decoder.decode(VIN_2011, { year: 2011 });
    expect(result.errors.some((err) => err.code === 'partition-not-found')).toBe(true);
  });

  it('deduplicates identical bindings when merging sub-leaves', async () => {
    const epoch = buildPartitionEpoch();
    const manifest = JSON.parse(epoch.leaves.get('1FA')!.leaf) as {
      partitions: Array<{ key: string; leafHash: string }>;
    };
    const partA = manifest.partitions[0].key;
    const partB = manifest.partitions[1]?.key;
    if (partB === undefined) {
      return;
    }
    const sharedBinding = JSON.parse(epoch.leaves.get(partA)!.leaf) as {
      bindings: Array<{ yearFrom: number; yearTo: number | null; schemaRef: string }>;
    };
    const duplicateBinding = sharedBinding.bindings[0];
    const subB = JSON.parse(epoch.leaves.get(partB)!.leaf) as typeof sharedBinding;
    subB.bindings.unshift(duplicateBinding);
    let tampered = replaceLeaf(epoch, partB, canonicalize(subB));
    const updatedManifest = JSON.parse(tampered.leaves.get('1FA')!.leaf) as typeof manifest;
    updatedManifest.partitions[1].leafHash = leafHashFor(tampered.leaves.get(partB)!.leaf);
    tampered = replaceLeaf(tampered, '1FA', canonicalize(updatedManifest));
    const decoder = decoderFromEpoch(tampered);
    const spy = vi.spyOn(modelYearModule, 'decodeModelYear').mockReturnValue({
      best: null,
      candidates: [2011, 2025],
      method: 'ambiguous',
    });
    const result = await decoder.decode(VIN_2011);
    spy.mockRestore();
    expect(result.errors).toEqual([]);
  });

  it('verifyLeaf accepts partition manifests in the Merkle tree', () => {
    const epoch = buildPartitionEpoch();
    const entry = epoch.leaves.get('1FA');
    expect(entry).toBeDefined();
    if (entry === undefined) {
      return;
    }
    const verified = verifyLeaf(entry.leaf, entry.proof, epoch.merkleRoot);
    expect(verified.ok).toBe(true);
    if (verified.ok) {
      expect(parseWireLeaf(verified.leaf).ok).toBe(true);
    }
  });
});

describe('parseWireLeaf edge cases', () => {
  it('rejects non-object input', () => {
    expect(parseWireLeaf(null).ok).toBe(false);
  });

  it('rejects manifests without string wmi', () => {
    expect(parseWireLeaf({ partitioned: true, partitions: [] }).ok).toBe(false);
  });

  it('rejects invalid partition entry yearTo', () => {
    expect(
      parseWireLeaf({
        wmi: '1FA',
        partitioned: true,
        partitions: [{ yearFrom: 2010, yearTo: 1.5, key: '1FA#p0', leafHash: 'sha256:ab' }],
      }).ok,
    ).toBe(false);
  });

  it('rejects non-object partition entries', () => {
    expect(
      parseWireLeaf({
        wmi: '1FA',
        partitioned: true,
        partitions: [null],
      }).ok,
    ).toBe(false);
  });
});
