import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => {
  const upload = vi.fn();
  const builder = {
    withWallet: vi.fn(),
    withRpc: vi.fn(),
    bundlerUrl: vi.fn(),
    devnet: vi.fn(),
    upload,
  };
  builder.withWallet.mockReturnValue(builder);
  builder.withRpc.mockReturnValue(builder);
  builder.bundlerUrl.mockReturnValue(builder);
  builder.devnet.mockResolvedValue(builder);
  return { builder, upload, Uploader: vi.fn(() => builder) };
});

vi.mock('@irys/upload', () => ({ Uploader: mocks.Uploader }));
vi.mock('@irys/upload-ethereum', () => ({ BaseEth: class BaseEth {} }));

import { createIrysDevnetUploader } from '../src/adapters/irys-devnet-uploader.js';

describe('createIrysDevnetUploader', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.builder.withWallet.mockReturnValue(mocks.builder);
    mocks.builder.withRpc.mockReturnValue(mocks.builder);
    mocks.builder.bundlerUrl.mockReturnValue(mocks.builder);
    mocks.builder.devnet.mockResolvedValue(mocks.builder);
  });

  it('uses Base Sepolia RPC, bundler URL, and Irys devnet', async () => {
    const uploader = await createIrysDevnetUploader({
      privateKeyHex: '0x1234',
      rpcUrl: 'https://sepolia.base.org',
    });

    expect(mocks.builder.withWallet).toHaveBeenCalledWith('0x1234');
    expect(mocks.builder.bundlerUrl).toHaveBeenCalledWith('https://devnet.irys.xyz');
    expect(mocks.builder.withRpc).toHaveBeenCalledWith('https://sepolia.base.org');
    expect(mocks.builder.devnet).toHaveBeenCalledOnce();

    mocks.upload.mockResolvedValue({ id: 'tx-1' });
    await expect(
      uploader.upload(new Uint8Array([1, 2]), [{ name: 'App', value: 'vincent' }]),
    ).resolves.toEqual({ id: 'tx-1', uri: 'ar://tx-1' });
  });
});
