import { parseEther } from 'viem';
import { describe, expect, it } from 'vitest';

import { preflightGenesisPublish } from '../src/preflight-genesis-publish.js';
import { TEST_PRIVATE_KEY, TEST_PUBLISHER } from '../src/constants.js';
import { createMockChainPublisher } from './mock-chain-publisher.js';

const PREFLIGHT_BASE = {
  rpcUrl: 'http://localhost:8545',
  irysRpcUrl: 'http://localhost:9545',
  getBalance: async () => parseEther('1'),
  getIrysPaymentBalance: async () => parseEther('1'),
  probeIrysUploader: async () => {},
  probeIrysGraphql: async () => {},
};

describe('preflightGenesisPublish', () => {
  it('passes when registry, balance, and Irys probes succeed', async () => {
    await expect(
      preflightGenesisPublish({
        privateKeyHex: TEST_PRIVATE_KEY,
        publisher: TEST_PUBLISHER,
        epochCountReader: createMockChainPublisher(),
        preflight: PREFLIGHT_BASE,
      }),
    ).resolves.toBeUndefined();
  });

  it('rejects when publisher already has on-chain epochs', async () => {
    const epochCountReader = createMockChainPublisher();
    await epochCountReader.publishEpoch({
      merkleRoot: `0x${'1'.repeat(64)}`,
      jsonlSha256: `0x${'2'.repeat(64)}`,
      manifestHash: `0x${'3'.repeat(64)}`,
      parentRoot: `0x${'0'.repeat(64)}`,
      manifestUri: 'ar://genesis',
    });

    await expect(
      preflightGenesisPublish({
        privateKeyHex: TEST_PRIVATE_KEY,
        publisher: TEST_PUBLISHER,
        epochCountReader,
        preflight: PREFLIGHT_BASE,
      }),
    ).rejects.toThrow(/already has 1 on-chain epoch/);
  });

  it('rejects when private key does not match publisher', async () => {
    await expect(
      preflightGenesisPublish({
        privateKeyHex: TEST_PRIVATE_KEY,
        publisher: '0x0000000000000000000000000000000000000001',
        epochCountReader: createMockChainPublisher(),
        preflight: PREFLIGHT_BASE,
      }),
    ).rejects.toThrow(/Private key derives/);
  });

  it('rejects when RPC balance lookup fails', async () => {
    await expect(
      preflightGenesisPublish({
        privateKeyHex: TEST_PRIVATE_KEY,
        publisher: TEST_PUBLISHER,
        epochCountReader: createMockChainPublisher(),
        preflight: {
          ...PREFLIGHT_BASE,
          getBalance: async () => {
            throw new Error('connection refused');
          },
        },
      }),
    ).rejects.toThrow(/Base Sepolia RPC unavailable/);
  });

  it('rejects when chain balance is below minimum', async () => {
    await expect(
      preflightGenesisPublish({
        privateKeyHex: TEST_PRIVATE_KEY,
        publisher: TEST_PUBLISHER,
        epochCountReader: createMockChainPublisher(),
        preflight: {
          ...PREFLIGHT_BASE,
          getBalance: async () => 0n,
        },
      }),
    ).rejects.toThrow(/Insufficient Base Sepolia balance/);
  });

  it('rejects when Irys payment balance is below minimum', async () => {
    await expect(
      preflightGenesisPublish({
        privateKeyHex: TEST_PRIVATE_KEY,
        publisher: TEST_PUBLISHER,
        epochCountReader: createMockChainPublisher(),
        preflight: {
          ...PREFLIGHT_BASE,
          getIrysPaymentBalance: async () => 0n,
        },
      }),
    ).rejects.toThrow(/Insufficient Ethereum Sepolia balance for Irys uploads/);
  });

  it('rejects when Irys probe fails', async () => {
    await expect(
      preflightGenesisPublish({
        privateKeyHex: TEST_PRIVATE_KEY,
        publisher: TEST_PUBLISHER,
        epochCountReader: createMockChainPublisher(),
        preflight: {
          ...PREFLIGHT_BASE,
          probeIrysUploader: async () => {
            throw new Error('wallet rejected');
          },
        },
      }),
    ).rejects.toThrow(/Irys devnet uploader unavailable/);
  });

  it('rejects when Irys GraphQL probe fails', async () => {
    await expect(
      preflightGenesisPublish({
        privateKeyHex: TEST_PRIVATE_KEY,
        publisher: TEST_PUBLISHER,
        epochCountReader: createMockChainPublisher(),
        preflight: {
          ...PREFLIGHT_BASE,
          irysGraphqlUrl: 'https://wrong.example/graphql',
          probeIrysGraphql: async () => {
            throw new Error('HTTP 404');
          },
        },
      }),
    ).rejects.toThrow(/Irys GraphQL unavailable.*HTTP 404/);
  });
});
