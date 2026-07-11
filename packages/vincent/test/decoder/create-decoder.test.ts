import { LEAF_CAP_BYTES } from '@kargain/vincent-compiler';
import { describe, expect, it } from 'vitest';

import { createDecoder } from '../../src/decoder/create-decoder.js';
import { buildDecoderFromClaims, compileEpoch } from './compile-helper.js';
import { loadGenesisMiniClaims, VIN_2011 } from './helpers.js';
import { buildPartitioned1FaClaims } from './partition-claims.js';

describe('createDecoder', () => {
  it('returns a decoder with async decode()', async () => {
    const decoder = buildDecoderFromClaims(loadGenesisMiniClaims());
    const result = await decoder.decode(VIN_2011);
    expect(result.wmi?.manufacturer).toMatch(/FORD/i);
    expect(result.wmi?.region).toBe('north-america');
  });

  it('caches verified leaves across decode calls', async () => {
    let fetches = 0;
    const epoch = compileEpoch(loadGenesisMiniClaims());
    const decoder = createDecoder({
      merkleRoot: epoch.merkleRoot,
      getLeaf: (wmi) => {
        fetches += 1;
        const entry = epoch.leaves.get(wmi);
        if (entry === undefined) {
          return Promise.reject(new Error(`missing leaf for ${wmi}`));
        }
        return Promise.resolve({ leaf: entry.leaf, proof: entry.proof });
      },
    });
    await decoder.decode(VIN_2011);
    await decoder.decode(VIN_2011);
    expect(fetches).toBe(1);
  });

  it('returns early for short VINs without loading leaves', async () => {
    const decoder = buildDecoderFromClaims(loadGenesisMiniClaims());
    const result = await decoder.decode('1F');
    expect(result.wmi).toBeNull();
    expect(result.attributes).toEqual([]);
  });

  it('reports proof-invalid when leaf is tampered', async () => {
    const epoch = compileEpoch(loadGenesisMiniClaims());
    const entry = epoch.leaves.get('1FA');
    expect(entry).toBeDefined();
    if (entry === undefined) {
      return;
    }
    const tampered = entry.leaf.replace('Fusion', 'XXXXXX');
    const decoder = createDecoder({
      merkleRoot: epoch.merkleRoot,
      getLeaf: () => Promise.resolve({ leaf: tampered, proof: entry.proof }),
    });
    const result = await decoder.decode(VIN_2011);
    expect(result.errors.some((err) => err.code === 'proof-invalid' || err.code === 'leaf-hash-mismatch')).toBe(
      true,
    );
  });

  it('reports leaf-hash-mismatch for non-canonical leaf bytes', async () => {
    const epoch = compileEpoch(loadGenesisMiniClaims());
    const entry = epoch.leaves.get('1FA');
    expect(entry).toBeDefined();
    if (entry === undefined) {
      return;
    }
    const pretty = `${JSON.stringify(JSON.parse(entry.leaf), null, 2)}`;
    const decoder = createDecoder({
      merkleRoot: epoch.merkleRoot,
      getLeaf: () => Promise.resolve({ leaf: pretty, proof: entry.proof }),
    });
    const result = await decoder.decode(VIN_2011);
    expect(result.errors.some((err) => err.code === 'leaf-hash-mismatch')).toBe(true);
  });

  it('reports invalid-leaf when leaf.wmi mismatches key', async () => {
    const epoch = compileEpoch(loadGenesisMiniClaims());
    const vf3 = epoch.leaves.get('VF3');
    expect(vf3).toBeDefined();
    if (vf3 === undefined) {
      return;
    }
    const decoder = createDecoder({
      merkleRoot: epoch.merkleRoot,
      getLeaf: (wmi) => {
        if (wmi === '1FA') {
          return Promise.resolve({ leaf: vf3.leaf, proof: vf3.proof });
        }
        const entry = epoch.leaves.get(wmi);
        if (entry === undefined) {
          return Promise.reject(new Error(`missing leaf for ${wmi}`));
        }
        return Promise.resolve({ leaf: entry.leaf, proof: entry.proof });
      },
    });
    const result = await decoder.decode(VIN_2011);
    expect(result.errors.some((err) => err.code === 'invalid-leaf')).toBe(true);
  });

  it('reports unknown-wmi when leaf is missing', async () => {
    const epoch = compileEpoch(loadGenesisMiniClaims());
    const decoder = createDecoder({
      merkleRoot: epoch.merkleRoot,
      getLeaf: () => Promise.reject(new Error('missing leaf for 1FA')),
    });
    const result = await decoder.decode(VIN_2011);
    expect(result.errors.some((err) => err.code === 'unknown-wmi')).toBe(true);
  });

  it('reports proof-invalid for wrong merkle root', async () => {
    const epoch = compileEpoch(loadGenesisMiniClaims());
    const decoder = createDecoder({
      merkleRoot: 'sha256:0000000000000000000000000000000000000000000000000000000000000000',
      getLeaf: (wmi) => {
        const entry = epoch.leaves.get(wmi);
        if (entry === undefined) {
          return Promise.reject(new Error(`missing leaf for ${wmi}`));
        }
        return Promise.resolve({ leaf: entry.leaf, proof: entry.proof });
      },
    });
    const result = await decoder.decode(VIN_2011);
    expect(result.errors.some((err) => err.code === 'proof-invalid')).toBe(true);
  });

  it('reports invalid-leaf when leaf JSON parses but is structurally invalid', async () => {
    const { canonicalize, sha256Hex } = await import('@kargain/vincent/protocol');
    const { buildMerkle } = await import('@kargain/vincent-compiler');
    const badDoc = { wmi: '1FA', bindings: 'nope', schemas: {} };
    const badLeaf = canonicalize(badDoc);
    const leafHash = `sha256:${sha256Hex(new TextEncoder().encode(badLeaf))}`;
    const tree = buildMerkle([leafHash]);
    const decoder = createDecoder({
      merkleRoot: tree.root,
      getLeaf: () => Promise.resolve({ leaf: badLeaf, proof: tree.proofFor(0) }),
    });
    const result = await decoder.decode(VIN_2011);
    expect(result.errors.some((err) => err.code === 'invalid-leaf')).toBe(true);
  });

  it('reports unknown-wmi when bundled table has no entry', async () => {
    const decoder = buildDecoderFromClaims(loadGenesisMiniClaims());
    const result = await decoder.decode('ZZZ00000000000000');
    expect(result.wmi).toBeNull();
    expect(result.errors.some((err) => err.code === 'unknown-wmi')).toBe(true);
  });

  it('origin is async and uses bundled wmi', async () => {
    const decoder = buildDecoderFromClaims(loadGenesisMiniClaims());
    const origin = await decoder.origin(VIN_2011);
    expect(origin.wmi?.region).toBe('north-america');
  });
});

describe('createDecoder partitioned leaves', () => {
  const CAP = 4096;

  function buildPartitionDecoder() {
    const claims = buildPartitioned1FaClaims(12, 24);
    const epoch = compileEpoch(claims, { leafCapBytes: CAP });
    const manifest = epoch.leaves.get('1FA');
    expect(manifest).toBeDefined();
    const parsed = JSON.parse(manifest!.leaf) as { partitioned?: boolean; partitions: unknown[] };
    expect(parsed.partitioned).toBe(true);
    expect(parsed.partitions.length).toBeGreaterThan(1);

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

  it('decodes VINs using the correct year-range partition', async () => {
    const decoder = buildPartitionDecoder();
    const result = await decoder.decode(VIN_2011, { year: 2011 });
    expect(result.errors).toEqual([]);
    expect(result.attributes.some((attr) => attr.attribute === 'model')).toBe(true);
  });

  it('returns base result when no partition matches the resolved year', async () => {
    const decoder = buildPartitionDecoder();
    const result = await decoder.decode(VIN_2011, { year: 1900 });
    expect(result.attributes).toEqual([]);
    expect(result.errors).toEqual([]);
  });

  it('reports partition-not-found when a sub-leaf is missing', async () => {
    const claims = buildPartitioned1FaClaims(12, 24);
    const epoch = compileEpoch(claims, { leafCapBytes: CAP });
    const manifest = JSON.parse(epoch.leaves.get('1FA')!.leaf) as {
      partitions: Array<{ key: string }>;
    };
    const missingKey = manifest.partitions[0].key;
    const decoder = createDecoder({
      merkleRoot: epoch.merkleRoot,
      getLeaf: (leafKey) => {
        if (leafKey === missingKey) {
          return Promise.reject(new Error(`missing leaf for ${missingKey}`));
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

  it('reports partition-leaf-hash-mismatch when manifest hash does not match sub-leaf', async () => {
    const claims = buildPartitioned1FaClaims(12, 24);
    const epoch = compileEpoch(claims, { leafCapBytes: CAP });
    const manifest = JSON.parse(epoch.leaves.get('1FA')!.leaf) as {
      partitions: Array<{ key: string; leafHash: string }>;
    };
    const target = manifest.partitions[0];
    const decoder = createDecoder({
      merkleRoot: epoch.merkleRoot,
      getLeaf: (leafKey) => {
        const entry = epoch.leaves.get(leafKey);
        if (entry === undefined) {
          return Promise.reject(new Error(`missing leaf for ${leafKey}`));
        }
        if (leafKey === target.key) {
          const tampered = entry.leaf.replace('"model"', '"xxxx"');
          return Promise.resolve({ leaf: tampered, proof: entry.proof });
        }
        return Promise.resolve({ leaf: entry.leaf, proof: entry.proof });
      },
    });
    const result = await decoder.decode(VIN_2011, { year: 2011 });
    expect(
      result.errors.some(
        (err) =>
          err.code === 'partition-leaf-hash-mismatch' ||
          err.code === 'proof-invalid' ||
          err.code === 'leaf-hash-mismatch',
      ),
    ).toBe(true);
  });

  it('uses default LEAF_CAP_BYTES for unpartitioned genesis-mini', () => {
    expect(LEAF_CAP_BYTES).toBe(128 * 1024);
    const epoch = compileEpoch(loadGenesisMiniClaims());
    expect([...epoch.leaves.keys()].some((key) => key.includes('#'))).toBe(false);
  });
});

describe('createDecoder fetch errors', () => {
  it('maps non-missing fetch failures to invalid-leaf', async () => {
    const epoch = compileEpoch(loadGenesisMiniClaims());
    const decoder = createDecoder({
      merkleRoot: epoch.merkleRoot,
      getLeaf: () => Promise.reject(new Error('network down')),
    });
    const result = await decoder.decode(VIN_2011);
    expect(result.errors.some((err) => err.code === 'invalid-leaf')).toBe(true);
  });

  it('maps non-Error rejections to invalid-leaf', async () => {
    const epoch = compileEpoch(loadGenesisMiniClaims());
    const decoder = createDecoder({
      merkleRoot: epoch.merkleRoot,
      // eslint-disable-next-line @typescript-eslint/prefer-promise-reject-errors -- cover non-Error catch path
      getLeaf: () => Promise.reject('boom'),
    });
    const result = await decoder.decode(VIN_2011);
    expect(result.errors.some((err) => err.code === 'invalid-leaf')).toBe(true);
  });
});
