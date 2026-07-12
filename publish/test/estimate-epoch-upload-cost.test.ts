import { compile } from '@kargain/vincent-compiler';
import { parseEther } from 'viem';
import { describe, expect, it, vi } from 'vitest';

import {
  assertSufficientUploadBudget,
  checkUploadBudgetSufficient,
  computeEpochUploadByteSizes,
} from '../src/estimate-epoch-upload-cost.js';
import { preflightEpochPublish } from '../src/preflight-genesis-publish.js';
import { TEST_PRIVATE_KEY, TEST_PUBLISHER } from '../src/constants.js';
import { loadGenesisMiniClaims } from './helpers.js';
import { createMockChainPublisher } from './mock-chain-publisher.js';

describe('estimate epoch upload cost', () => {
  it('includes every leaf plus JSONL and manifest uploads', () => {
    const built = compile(loadGenesisMiniClaims(), {});
    if (!built.ok) {
      throw new Error(built.error.message);
    }

    const sizes = computeEpochUploadByteSizes(built.value, 1, null);
    expect(sizes).toHaveLength(built.value.leaves.size + 2);
    expect(sizes.every((size) => size > 0)).toBe(true);
  });

  it('requires buffered headroom over quoted cost', () => {
    const result = checkUploadBudgetSufficient({
      estimatedCostWei: parseEther('0.1'),
      irysLoadedBalanceWei: 0n,
      walletBalanceWei: parseEther('0.05'),
      bufferMultiplier: 1.1,
    });

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.requiredWei).toBe(parseEther('0.11'));
      expect(result.availableWei).toBe(parseEther('0.05'));
    }
  });

  it('passes when funded plus wallet cover quoted cost with buffer', () => {
    const result = checkUploadBudgetSufficient({
      estimatedCostWei: parseEther('0.1'),
      irysLoadedBalanceWei: parseEther('0.05'),
      walletBalanceWei: parseEther('0.06'),
      bufferMultiplier: 1.1,
    });

    expect(result).toEqual({ ok: true });
  });

  it('applies the default safety buffer when none is provided', () => {
    const result = checkUploadBudgetSufficient({
      estimatedCostWei: 10n,
      irysLoadedBalanceWei: 0n,
      walletBalanceWei: 11n,
    });

    expect(result).toEqual({ ok: true });
  });

  it('rejects invalid buffer multipliers', () => {
    expect(() =>
      checkUploadBudgetSufficient({
        estimatedCostWei: 1n,
        irysLoadedBalanceWei: 0n,
        walletBalanceWei: 0n,
        bufferMultiplier: 0.5,
      }),
    ).toThrow(/bufferMultiplier must be a finite number >= 1/);
  });

  it('uses Irys price quotes when budget overrides are not provided', async () => {
    const built = compile(loadGenesisMiniClaims(), {});
    if (!built.ok) {
      throw new Error(built.error.message);
    }

    const mockEstimate = vi.fn(async () => ({
      integerValue: () => ({ toString: () => parseEther('0.01').toString() }),
    }));
    const mockLoaded = vi.fn(async () => ({
      integerValue: () => ({ toString: () => '0' }),
    }));

    await expect(
      assertSufficientUploadBudget({
        privateKeyHex: TEST_PRIVATE_KEY,
        rpcUrl: 'http://mock-eth-sepolia',
        epoch: built.value,
        epochNumber: 1,
        parentRootContentId: null,
        walletBalanceWei: parseEther('0.001'),
        irysClientFactory: async () => ({
          utils: { estimateFolderPrice: mockEstimate },
          getLoadedBalance: mockLoaded,
        }),
      }),
    ).rejects.toThrow(/Insufficient Ethereum Sepolia \/ Irys upload budget/);

    expect(mockEstimate).toHaveBeenCalled();
    expect(mockLoaded).toHaveBeenCalled();
  });

  it('passes when only the upload cost override is provided', async () => {
    const built = compile(loadGenesisMiniClaims(), {});
    if (!built.ok) {
      throw new Error(built.error.message);
    }

    await expect(
      assertSufficientUploadBudget({
        privateKeyHex: TEST_PRIVATE_KEY,
        rpcUrl: 'http://mock-eth-sepolia',
        epoch: built.value,
        epochNumber: 1,
        parentRootContentId: null,
        walletBalanceWei: parseEther('1'),
        estimateUploadCostWei: async () => parseEther('0.01'),
        irysClientFactory: async () => ({
          utils: {
            estimateFolderPrice: async () => {
              throw new Error('should not quote');
            },
          },
          getLoadedBalance: async () => ({
            integerValue: () => ({ toString: () => '0' }),
          }),
        }),
      }),
    ).resolves.toBeUndefined();
  });

  it('passes when Irys quote fits funded plus wallet balance', async () => {
    const built = compile(loadGenesisMiniClaims(), {});
    if (!built.ok) {
      throw new Error(built.error.message);
    }

    await expect(
      assertSufficientUploadBudget({
        privateKeyHex: TEST_PRIVATE_KEY,
        rpcUrl: 'http://mock-eth-sepolia',
        epoch: built.value,
        epochNumber: 1,
        parentRootContentId: null,
        walletBalanceWei: parseEther('1'),
        estimateUploadCostWei: async () => parseEther('0.01'),
        getIrysLoadedBalance: async () => 0n,
      }),
    ).resolves.toBeUndefined();

    await expect(
      assertSufficientUploadBudget({
        privateKeyHex: TEST_PRIVATE_KEY,
        rpcUrl: 'http://mock-eth-sepolia',
        epoch: built.value,
        epochNumber: 2,
        parentRootContentId: 'sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
        walletBalanceWei: parseEther('1'),
        irysClientFactory: async () => ({
          utils: {
            estimateFolderPrice: async () => ({
              integerValue: () => ({ toString: () => parseEther('0.01').toString() }),
            }),
          },
          getLoadedBalance: async () => ({
            integerValue: () => ({ toString: () => parseEther('0.005').toString() }),
          }),
        }),
      }),
    ).resolves.toBeUndefined();
  });
});

describe('preflight upload budget', () => {
  it('aborts before uploads when quoted cost exceeds wallet headroom', async () => {
    const built = compile(loadGenesisMiniClaims(), {});
    if (!built.ok) {
      throw new Error(built.error.message);
    }

    await expect(
      preflightEpochPublish({
        privateKeyHex: TEST_PRIVATE_KEY,
        publisher: TEST_PUBLISHER,
        epochCountReader: createMockChainPublisher(),
        preflight: {
          rpcUrl: 'http://localhost:8545',
          getBalance: async () => parseEther('1'),
          getIrysPaymentBalance: async () => parseEther('0.001'),
          probeIrysUploader: async () => {},
          uploadBudget: {
            epoch: built.value,
            epochNumber: 1,
            parentRootContentId: null,
            estimateUploadCostWei: async () => parseEther('0.01'),
            getIrysLoadedBalance: async () => 0n,
          },
        },
      }),
    ).rejects.toThrow(/Insufficient Ethereum Sepolia \/ Irys upload budget/);
  });
});
