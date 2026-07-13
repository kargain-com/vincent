const mocks = vi.hoisted(() => {
  const builder = {
    withWallet: vi.fn(),
    bundlerUrl: vi.fn(),
    withRpc: vi.fn(),
    devnet: vi.fn(),
    api: {
      getConfig: vi.fn(() => ({ url: 'https://example.test', timeout: 30_000 })),
      applyConfig: vi.fn(),
    },
    url: new URL('https://devnet.irys.xyz'),
  };
  builder.withWallet.mockReturnValue(builder);
  builder.bundlerUrl.mockReturnValue(builder);
  builder.withRpc.mockReturnValue(builder);
  builder.devnet.mockResolvedValue(builder);

  return {
    builder,
    Uploader: vi.fn(() => builder),
  };
});

vi.mock('@irys/upload', () => ({
  Uploader: mocks.Uploader,
}));

vi.mock('@irys/upload-ethereum', () => ({
  BaseEth: 'base-eth',
}));

import { beforeEach, describe, expect, it, vi } from 'vitest';

import {
  BASE_MAINNET_CHAIN_ID,
  BASE_SEPOLIA_CHAIN_ID,
  IRYS_DEVNET_BUNDLER_URL,
  IRYS_MAINNET_BUNDLER_URL,
} from '../src/constants.js';
import { createIrysClient } from '../src/adapters/irys-client.js';

describe('createIrysClient', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.builder.devnet.mockResolvedValue(mocks.builder);
    mocks.builder.withRpc.mockReturnValue(mocks.builder);
  });

  it('uses devnet bundler and .devnet() on Base Sepolia', async () => {
    await createIrysClient({
      chainId: BASE_SEPOLIA_CHAIN_ID,
      privateKeyHex: '0xabc',
      rpcUrl: 'https://sepolia.base.org',
    });

    expect(mocks.builder.bundlerUrl).toHaveBeenCalledWith(IRYS_DEVNET_BUNDLER_URL);
    expect(mocks.builder.devnet).toHaveBeenCalledOnce();
  });

  it('uses mainnet bundler without .devnet() on Base mainnet', async () => {
    mocks.builder.devnet.mockClear();

    await createIrysClient({
      chainId: BASE_MAINNET_CHAIN_ID,
      privateKeyHex: '0xabc',
      rpcUrl: 'https://mainnet.base.org',
    });

    expect(mocks.builder.bundlerUrl).toHaveBeenCalledWith(IRYS_MAINNET_BUNDLER_URL);
    expect(mocks.builder.devnet).not.toHaveBeenCalled();
  });
});
