import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => {
  const upload = vi.fn();
  const builder = {
    withWallet: vi.fn(),
    withRpc: vi.fn(),
    devnet: vi.fn(),
    upload,
  };
  builder.withWallet.mockReturnValue(builder);
  builder.withRpc.mockReturnValue(builder);
  builder.devnet.mockResolvedValue(builder);
  return { builder, upload, Uploader: vi.fn(() => builder) };
});

vi.mock('@irys/upload', () => ({ Uploader: mocks.Uploader }));
vi.mock('@irys/upload-ethereum', () => ({ Ethereum: class Ethereum {} }));

import { createIrysDevnetUploader } from '../src/adapters/irys-devnet-uploader.js';

describe('createIrysDevnetUploader', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.builder.withWallet.mockReturnValue(mocks.builder);
    mocks.builder.withRpc.mockReturnValue(mocks.builder);
    mocks.builder.devnet.mockResolvedValue(mocks.builder);
  });

  it('uses the EVM RPC and explicitly selects Irys devnet', async () => {
    const uploader = await createIrysDevnetUploader({
      privateKeyHex: '0x1234',
      rpcUrl: 'https://rpc.sepolia.org',
    });

    expect(mocks.builder.withWallet).toHaveBeenCalledWith('0x1234');
    expect(mocks.builder.withRpc).toHaveBeenCalledWith('https://rpc.sepolia.org');
    expect(mocks.builder.devnet).toHaveBeenCalledOnce();

    mocks.upload.mockResolvedValue({ id: 'tx-1' });
    await expect(
      uploader.upload(new Uint8Array([1, 2]), [{ name: 'App', value: 'vincent' }]),
    ).resolves.toEqual({ id: 'tx-1', uri: 'ar://tx-1' });
  });
});
