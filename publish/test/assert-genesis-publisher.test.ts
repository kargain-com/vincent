import { describe, expect, it } from 'vitest';

import { assertGenesisPublisherAvailable } from '../src/assert-genesis-publisher.js';
import { TEST_PUBLISHER } from '../src/constants.js';
import { createMockChainPublisher } from './mock-chain-publisher.js';

describe('assertGenesisPublisherAvailable', () => {
  it('allows a publisher with no on-chain epochs', async () => {
    const chainPublisher = createMockChainPublisher();

    await expect(
      assertGenesisPublisherAvailable(chainPublisher, TEST_PUBLISHER),
    ).resolves.toBeUndefined();
  });

  it('rejects a publisher that already published genesis', async () => {
    const chainPublisher = createMockChainPublisher();
    await chainPublisher.publishEpoch({
      merkleRoot: `0x${'1'.repeat(64)}`,
      jsonlSha256: `0x${'2'.repeat(64)}`,
      manifestHash: `0x${'3'.repeat(64)}`,
      parentRoot: `0x${'0'.repeat(64)}`,
      manifestUri: 'ar://genesis',
    });

    await expect(
      assertGenesisPublisherAvailable(chainPublisher, TEST_PUBLISHER),
    ).rejects.toThrow(/already has 1 on-chain epoch/);
  });
});
