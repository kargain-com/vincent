import { describe, expect, it } from 'vitest';

import { sha256ContentIdToBytes32, ZERO_BYTES32 } from '../src/adapters/sha256-bytes32.js';
import { resolveEpochParent } from '../src/resolve-epoch-parent.js';
import { TEST_PUBLISHER } from '../src/constants.js';
import { createMockChainPublisher } from './mock-chain-publisher.js';

describe('resolveEpochParent', () => {
  it('returns genesis parent when epochCount is zero', async () => {
    const reader = createMockChainPublisher();
    const resolved = await resolveEpochParent(reader, TEST_PUBLISHER);

    expect(resolved).toEqual({
      epochNumber: 1,
      parentRootBytes32: ZERO_BYTES32,
      parentRootContentId: null,
    });
  });

  it('returns prior merkleRoot when epochCount is greater than zero', async () => {
    const reader = createMockChainPublisher();
    const genesisRoot = sha256ContentIdToBytes32(
      'sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
    );

    await reader.publishEpoch({
      merkleRoot: genesisRoot,
      jsonlSha256: `0x${'b'.repeat(64)}`,
      manifestHash: `0x${'c'.repeat(64)}`,
      parentRoot: ZERO_BYTES32,
      manifestUri: 'ar://genesis',
    });

    const resolved = await resolveEpochParent(reader, TEST_PUBLISHER);

    expect(resolved.epochNumber).toBe(2);
    expect(resolved.parentRootBytes32).toBe(genesisRoot);
    expect(resolved.parentRootContentId).toBe(
      'sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
    );
  });
});
