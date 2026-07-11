import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

import { buildMerkle, foldMerkleProof } from '../src/merkle.js';

const FIXTURE = join(dirname(fileURLToPath(import.meta.url)), '../fixtures/merkle-rfc6962.json');

interface MerkleFixture {
  scheme: {
    leaf: string;
    internal: string;
    oddNode: string;
  };
  vectors: Array<{
    name: string;
    digests: string[];
    root: string;
    depth: number;
    proofs: Array<{
      index: number;
      leafHash: string;
      proof: Array<{ hash: string; side: 'left' | 'right' }>;
    }>;
  }>;
}

describe('Merkle RFC6962 scheme', () => {
  const fixture = JSON.parse(readFileSync(FIXTURE, 'utf8')) as MerkleFixture;

  it('documents domain separation and odd-node rule', () => {
    expect(fixture.scheme.leaf).toContain('0x00');
    expect(fixture.scheme.internal).toContain('0x01');
    expect(fixture.scheme.oddNode).toMatch(/carry.*unchanged/i);
  });

  it('matches committed test vectors', () => {
    for (const vector of fixture.vectors) {
      const tree = buildMerkle(vector.digests);
      expect(tree.root).toBe(vector.root);
      expect(tree.depth).toBe(vector.depth);

      for (const entry of vector.proofs) {
        expect(tree.proofFor(entry.index)).toEqual(entry.proof);
        expect(foldMerkleProof(entry.leafHash, entry.proof)).toBe(vector.root);
      }
    }
  });

  it('rejects out-of-range proof requests', () => {
    const tree = buildMerkle([
      'sha256:0000000000000000000000000000000000000000000000000000000000000001',
    ]);
    expect(() => tree.proofFor(1)).toThrow(/out of range/);
  });

  it('rejects proofFor on empty tree', () => {
    const tree = buildMerkle([]);
    expect(() => tree.proofFor(0)).toThrow(/no leaves/);
  });
});
