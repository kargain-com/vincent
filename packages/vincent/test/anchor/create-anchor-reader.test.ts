import { baseSepolia } from 'viem/chains';
import { describe, expect, it, vi } from 'vitest';

import { createAnchorReader } from '../../src/anchor/create-anchor-reader.js';
import { DEFAULT_REGISTRY_ADDRESS } from '../../src/anchor/types.js';
import type { OnChainEpochTuple } from '../../src/anchor/types.js';

const PUBLISHER = '0xa0e58EC0f3dF4f127e9203A7fd6a494c483719B3' as const;

const SAMPLE_EPOCH: OnChainEpochTuple = {
  merkleRoot: '0x76f6692120d6f8316af6109aee98f8c4782ef6111f2d16959745459df0604f3c',
  jsonlSha256: '0x1111111111111111111111111111111111111111111111111111111111111111',
  manifestHash: '0x2222222222222222222222222222222222222222222222222222222222222222',
  parentRoot: '0x0000000000000000000000000000000000000000000000000000000000000000',
  timestamp: 1_700_000_000n,
  manifestUri: 'ar://manifest-txid',
};

const LINKED_EPOCH: OnChainEpochTuple = {
  ...SAMPLE_EPOCH,
  parentRoot: '0x76f6692120d6f8316af6109aee98f8c4782ef6111f2d16959745459df0604f3c',
};

function createMockPublicClient(
  handlers: Partial<{
    epochCount: (publisher: string) => bigint;
    getEpoch: (publisher: string, index: bigint) => OnChainEpochTuple;
    latestEpoch: (publisher: string) => OnChainEpochTuple;
  }> = {},
) {
  return {
    readContract: vi.fn(
      async (args: {
        functionName: 'epochCount' | 'getEpoch' | 'latestEpoch';
        args: readonly unknown[];
      }) => {
        const [publisher, index] = args.args;
        if (args.functionName === 'epochCount') {
          return handlers.epochCount?.(publisher as string) ?? 1n;
        }
        if (args.functionName === 'getEpoch') {
          return handlers.getEpoch?.(publisher as string, index as bigint) ?? SAMPLE_EPOCH;
        }
        return handlers.latestEpoch?.(publisher as string) ?? SAMPLE_EPOCH;
      },
    ),
  };
}

describe('createAnchorReader', () => {
  it('requires rpcUrl when no publicClient is provided', () => {
    expect(() =>
      createAnchorReader({
        chain: baseSepolia,
      }),
    ).toThrow('rpcUrl is required when no publicClient is provided');
  });

  it('uses default registry address', async () => {
    const publicClient = createMockPublicClient();
    const reader = createAnchorReader({
      chain: baseSepolia,
      publicClient: publicClient as never,
    });

    await reader.getEpochCount(PUBLISHER);

    expect(publicClient.readContract).toHaveBeenCalledWith(
      expect.objectContaining({ address: DEFAULT_REGISTRY_ADDRESS }),
    );
  });

  it('uses custom registry address', async () => {
    const customRegistry = '0x1234567890123456789012345678901234567890' as const;
    const publicClient = createMockPublicClient();
    const reader = createAnchorReader({
      chain: baseSepolia,
      registryAddress: customRegistry,
      publicClient: publicClient as never,
    });

    await reader.getEpochCount(PUBLISHER);

    expect(publicClient.readContract).toHaveBeenCalledWith(
      expect.objectContaining({ address: customRegistry }),
    );
  });

  it('getEpochCount returns a number', async () => {
    const publicClient = createMockPublicClient({
      epochCount: () => 3n,
    });
    const reader = createAnchorReader({
      chain: baseSepolia,
      publicClient: publicClient as never,
    });

    await expect(reader.getEpochCount(PUBLISHER)).resolves.toBe(3);
  });

  it('getEpoch maps on-chain tuple to protocol form with null genesis parentRoot', async () => {
    const publicClient = createMockPublicClient();
    const reader = createAnchorReader({
      chain: baseSepolia,
      publicClient: publicClient as never,
    });

    const epoch = await reader.getEpoch(PUBLISHER, 0);

    expect(epoch).toEqual({
      epoch: 0,
      merkleRoot: 'sha256:76f6692120d6f8316af6109aee98f8c4782ef6111f2d16959745459df0604f3c',
      jsonlSha256: 'sha256:1111111111111111111111111111111111111111111111111111111111111111',
      manifestHash: 'sha256:2222222222222222222222222222222222222222222222222222222222222222',
      parentRoot: null,
      timestamp: 1_700_000_000,
      manifestUri: 'ar://manifest-txid',
    });
  });

  it('getEpoch maps non-zero parentRoot to sha256 content id', async () => {
    const publicClient = createMockPublicClient({
      getEpoch: () => LINKED_EPOCH,
    });
    const reader = createAnchorReader({
      chain: baseSepolia,
      publicClient: publicClient as never,
    });

    const epoch = await reader.getEpoch(PUBLISHER, 1);

    expect(epoch.epoch).toBe(1);
    expect(epoch.parentRoot).toBe(
      'sha256:76f6692120d6f8316af6109aee98f8c4782ef6111f2d16959745459df0604f3c',
    );
  });

  it('getLatestEpoch attaches epoch index from count minus one', async () => {
    const publicClient = createMockPublicClient({
      epochCount: () => 2n,
      latestEpoch: () => LINKED_EPOCH,
    });
    const reader = createAnchorReader({
      chain: baseSepolia,
      publicClient: publicClient as never,
    });

    const epoch = await reader.getLatestEpoch(PUBLISHER);

    expect(epoch.epoch).toBe(1);
    expect(epoch.merkleRoot).toBe(
      'sha256:76f6692120d6f8316af6109aee98f8c4782ef6111f2d16959745459df0604f3c',
    );
  });

  it('propagates contract revert when latestEpoch has no epochs', async () => {
    const publicClient = createMockPublicClient({
      epochCount: () => 0n,
      latestEpoch: () => {
        throw new Error('no epochs');
      },
    });
    const reader = createAnchorReader({
      chain: baseSepolia,
      publicClient: publicClient as never,
    });

    await expect(reader.getLatestEpoch(PUBLISHER)).rejects.toThrow('no epochs');
  });

  it('constructs a public client from rpcUrl', async () => {
    const reader = createAnchorReader({
      rpcUrl: 'http://127.0.0.1:8545',
      chain: baseSepolia,
    });

    await expect(reader.getEpochCount(PUBLISHER)).rejects.toThrow();
  });
});
