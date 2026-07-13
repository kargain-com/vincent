import { describe, expect, it } from 'vitest';

import {
  BASE_MAINNET_CHAIN_ID,
  BASE_SEPOLIA_CHAIN_ID,
  IRYS_DEVNET_BUNDLER_URL,
  IRYS_MAINNET_BUNDLER_URL,
  isBaseMainnetChainId,
  resolveIrysBundlerUrl,
} from '../src/constants.js';

describe('Irys network constants', () => {
  it('resolves bundler URLs for Base mainnet and Sepolia', () => {
    expect(resolveIrysBundlerUrl(BASE_MAINNET_CHAIN_ID)).toBe(IRYS_MAINNET_BUNDLER_URL);
    expect(resolveIrysBundlerUrl(BASE_SEPOLIA_CHAIN_ID)).toBe(IRYS_DEVNET_BUNDLER_URL);
  });

  it('treats Ethereum mainnet as mainnet bundler (Kargain parity)', () => {
    expect(resolveIrysBundlerUrl(1)).toBe(IRYS_MAINNET_BUNDLER_URL);
  });

  it('rejects unsupported chains', () => {
    expect(() => resolveIrysBundlerUrl(31_337)).toThrow(/Unsupported chain for Irys bundler/);
  });

  it('identifies Base mainnet chain id', () => {
    expect(isBaseMainnetChainId(BASE_MAINNET_CHAIN_ID)).toBe(true);
    expect(isBaseMainnetChainId(BASE_SEPOLIA_CHAIN_ID)).toBe(false);
  });
});
