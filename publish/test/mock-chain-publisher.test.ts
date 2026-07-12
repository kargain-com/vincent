import { describe, expect, it } from 'vitest';

import { ZERO_BYTES32 } from '../src/adapters/sha256-bytes32.js';
import { createMockChainPublisher } from './mock-chain-publisher.js';

describe('mock chain publisher registry rules', () => {
  it('reverts genesis with non-zero parentRoot', async () => {
    const chainPublisher = createMockChainPublisher();

    await expect(
      chainPublisher.publishEpoch({
        merkleRoot: `0x${'1'.repeat(64)}`,
        jsonlSha256: `0x${'2'.repeat(64)}`,
        manifestHash: `0x${'3'.repeat(64)}`,
        parentRoot: `0x${'4'.repeat(64)}`,
        manifestUri: 'ar://genesis',
      }),
    ).rejects.toThrow(/genesis parentRoot must be zero/);
  });

  it('reverts second epoch with zero parentRoot', async () => {
    const chainPublisher = createMockChainPublisher();

    await chainPublisher.publishEpoch({
      merkleRoot: `0x${'1'.repeat(64)}`,
      jsonlSha256: `0x${'2'.repeat(64)}`,
      manifestHash: `0x${'3'.repeat(64)}`,
      parentRoot: ZERO_BYTES32,
      manifestUri: 'ar://genesis',
    });

    await expect(
      chainPublisher.publishEpoch({
        merkleRoot: `0x${'5'.repeat(64)}`,
        jsonlSha256: `0x${'6'.repeat(64)}`,
        manifestHash: `0x${'7'.repeat(64)}`,
        parentRoot: ZERO_BYTES32,
        manifestUri: 'ar://epoch-2',
      }),
    ).rejects.toThrow(/parentRoot mismatch/);
  });

  it('accepts second epoch with correct parentRoot', async () => {
    const chainPublisher = createMockChainPublisher();
    const merkleRoot1 = `0x${'1'.repeat(64)}`;

    await chainPublisher.publishEpoch({
      merkleRoot: merkleRoot1,
      jsonlSha256: `0x${'2'.repeat(64)}`,
      manifestHash: `0x${'3'.repeat(64)}`,
      parentRoot: ZERO_BYTES32,
      manifestUri: 'ar://genesis',
    });

    await chainPublisher.publishEpoch({
      merkleRoot: `0x${'5'.repeat(64)}`,
      jsonlSha256: `0x${'6'.repeat(64)}`,
      manifestHash: `0x${'7'.repeat(64)}`,
      parentRoot: merkleRoot1,
      manifestUri: 'ar://epoch-2',
    });

    expect(await chainPublisher.readEpochCount(chainPublisher.publisher)).toBe(2n);
    expect(chainPublisher.readLatestEpoch().manifestUri).toBe('ar://epoch-2');
  });
});
