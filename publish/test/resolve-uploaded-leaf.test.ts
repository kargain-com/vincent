import { LeafNotFoundError } from '@kargain/vincent/arweave';
import { compile } from '@kargain/vincent-compiler';
import { describe, expect, it, vi } from 'vitest';

import { isLeafAlreadyUploaded } from '../src/resolve-uploaded-leaf.js';
import { loadGenesisMiniClaims } from './helpers.js';

describe('isLeafAlreadyUploaded', () => {
  it('returns true when getLeaf returns Merkle-valid data', async () => {
    const built = compile(loadGenesisMiniClaims(), {});
    if (!built.ok) {
      throw new Error(built.error.message);
    }
    const entry = built.value.leaves.get('1FA');
    if (entry === undefined) {
      throw new Error('missing 1FA leaf');
    }

    const getLeaf = vi.fn().mockResolvedValue({
      leaf: entry.leaf,
      proof: entry.proof,
    });

    await expect(
      isLeafAlreadyUploaded(getLeaf, '1FA', built.value.merkleRoot),
    ).resolves.toBe(true);
  });

  it('returns false when the leaf is missing', async () => {
    const getLeaf = vi.fn().mockRejectedValue(new LeafNotFoundError('1FA'));

    await expect(isLeafAlreadyUploaded(getLeaf, '1FA', 'sha256:00')).resolves.toBe(false);
  });

  it('returns false when Merkle proof does not match merkleRoot', async () => {
    const built = compile(loadGenesisMiniClaims(), {});
    if (!built.ok) {
      throw new Error(built.error.message);
    }
    const entry = built.value.leaves.get('1FA');
    if (entry === undefined) {
      throw new Error('missing 1FA leaf');
    }

    const getLeaf = vi.fn().mockResolvedValue({
      leaf: entry.leaf,
      proof: entry.proof,
    });

    await expect(
      isLeafAlreadyUploaded(getLeaf, '1FA', 'sha256:' + 'f'.repeat(64)),
    ).resolves.toBe(false);
  });

  it('rethrows non-not-found errors', async () => {
    const getLeaf = vi.fn().mockRejectedValue(new Error('graphql request failed: 503'));

    await expect(isLeafAlreadyUploaded(getLeaf, '1FA', 'sha256:00')).rejects.toThrow(
      'graphql request failed: 503',
    );
  });
});
