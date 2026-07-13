import { describe, expect, it } from 'vitest';

import { createMockChainPublisher } from './mock-chain-publisher.js';

describe('waitForLatestEpoch', () => {
  it('requires minEpochCount and expectedManifestUri for incremental publishers', async () => {
    const chainPublisher = createMockChainPublisher();
    await chainPublisher.publishEpoch({
      merkleRoot: `0x${'a'.repeat(64)}`,
      jsonlSha256: `0x${'b'.repeat(64)}`,
      manifestHash: `0x${'c'.repeat(64)}`,
      parentRoot: `0x${'0'.repeat(64)}`,
      manifestUri: 'ar://epoch-1',
    });

    await expect(
      chainPublisher.waitForLatestEpoch(chainPublisher.publisher, {
        minEpochCount: 2n,
        expectedManifestUri: 'ar://epoch-2',
      }),
    ).rejects.toThrow(/epoch count 1 < 2/);

    await chainPublisher.publishEpoch({
      merkleRoot: `0x${'d'.repeat(64)}`,
      jsonlSha256: `0x${'e'.repeat(64)}`,
      manifestHash: `0x${'f'.repeat(64)}`,
      parentRoot: `0x${'a'.repeat(64)}`,
      manifestUri: 'ar://epoch-2',
    });

    const latest = await chainPublisher.waitForLatestEpoch(chainPublisher.publisher, {
      minEpochCount: 2n,
      expectedManifestUri: 'ar://epoch-2',
    });
    expect(latest.manifestUri).toBe('ar://epoch-2');
  });
});
