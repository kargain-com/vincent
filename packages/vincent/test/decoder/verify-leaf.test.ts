import { buildMerkle } from '@kargain/vincent-compiler';
import { canonicalize, sha256Hex } from '@kargain/vincent/protocol';
import { describe, expect, it, vi } from 'vitest';

import * as protocol from '@kargain/vincent/protocol';

import { verifyLeaf, foldMerkleProof } from '../../src/decoder/verify-leaf.js';
import { compileEpoch } from './compile-helper.js';
import { loadGenesisMiniClaims } from './helpers.js';

describe('verifyLeaf', () => {
  it('accepts genesis-mini leaves against the compiled merkle root', () => {
    const epoch = compileEpoch(loadGenesisMiniClaims());
    for (const [, entry] of epoch.leaves) {
      const result = verifyLeaf(entry.leaf, entry.proof, epoch.merkleRoot);
      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.leafHash).toBe(entry.leafHash);
      }
    }
  });

  it('rejects non-canonical leaf bytes', () => {
    const epoch = compileEpoch(loadGenesisMiniClaims());
    const entry = epoch.leaves.get('1FA');
    expect(entry).toBeDefined();
    if (entry === undefined) {
      return;
    }
    const pretty = `${JSON.stringify(JSON.parse(entry.leaf), null, 2)}`;
    const result = verifyLeaf(pretty, entry.proof, epoch.merkleRoot);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.code).toBe('leaf-hash-mismatch');
    }
  });

  it('rejects proof that does not fold to merkleRoot', () => {
    const epoch = compileEpoch(loadGenesisMiniClaims());
    const entry = epoch.leaves.get('1FA');
    expect(entry).toBeDefined();
    if (entry === undefined) {
      return;
    }
    const result = verifyLeaf(
      entry.leaf,
      entry.proof,
      'sha256:0000000000000000000000000000000000000000000000000000000000000000',
    );
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.code).toBe('proof-invalid');
    }
  });

  it('rejects invalid JSON', () => {
    const result = verifyLeaf('{bad', [], 'sha256:00');
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.code).toBe('invalid-leaf');
    }
  });

  it('rejects non-canonicalizable JSON', () => {
    const spy = vi.spyOn(protocol, 'canonicalize').mockImplementation(() => {
      throw new protocol.CanonicalizeError('bad');
    });
    const result = verifyLeaf('{"wmi":"1FA"}', [], 'sha256:00');
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.code).toBe('invalid-leaf');
    }
    spy.mockRestore();
  });

  it('rejects invalid proof steps', () => {
    const leaf = canonicalize({ wmi: '1FA', bindings: [], schemas: {} });
    const leafHash = `sha256:${sha256Hex(new TextEncoder().encode(leaf))}`;
    const tree = buildMerkle([leafHash]);
    const result = verifyLeaf(leaf, [{ hash: 'not-a-hash', side: 'right' }], tree.root);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.code).toBe('proof-invalid');
    }
  });

  it('rejects non-array proof', () => {
    const leaf = canonicalize({ wmi: '1FA', bindings: [], schemas: {} });
    const result = verifyLeaf(leaf, null as unknown as [], 'sha256:00');
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.code).toBe('proof-invalid');
    }
  });

  it('rejects parse failures after valid proof', () => {
    const bad = canonicalize({ wmi: '1FA', bindings: 'x', schemas: {} });
    const leafHash = `sha256:${sha256Hex(new TextEncoder().encode(bad))}`;
    const tree = buildMerkle([leafHash]);
    const result = verifyLeaf(bad, tree.proofFor(0), tree.root);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.code).toBe('invalid-leaf');
    }
  });

  it('accepts Uint8Array leaf content', () => {
    const epoch = compileEpoch(loadGenesisMiniClaims());
    const entry = epoch.leaves.get('VF3');
    expect(entry).toBeDefined();
    if (entry === undefined) {
      return;
    }
    const bytes = new TextEncoder().encode(entry.leaf);
    expect(verifyLeaf(bytes, entry.proof, epoch.merkleRoot).ok).toBe(true);
  });

  it('foldMerkleProof rejects invalid leaf digests and sides', () => {
    expect(foldMerkleProof('not-a-hash', [])).toBeNull();
    expect(
      foldMerkleProof(
        'sha256:0000000000000000000000000000000000000000000000000000000000000001',
        [{ hash: 'sha256:0000000000000000000000000000000000000000000000000000000000000002', side: 'up' as 'left' }],
      ),
    ).toBeNull();
  });
});
