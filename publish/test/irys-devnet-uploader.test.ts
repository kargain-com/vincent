import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => {
  const upload = vi.fn();
  const applyConfig = vi.fn();
  const getConfig = vi.fn(() => ({
    url: new URL('https://devnet.irys.xyz'),
    timeout: 20_000,
  }));
  const builder = {
    withWallet: vi.fn(),
    withRpc: vi.fn(),
    bundlerUrl: vi.fn(),
    devnet: vi.fn(),
    upload,
    url: new URL('https://devnet.irys.xyz'),
    api: { applyConfig, getConfig },
  };
  builder.withWallet.mockReturnValue(builder);
  builder.withRpc.mockReturnValue(builder);
  builder.bundlerUrl.mockReturnValue(builder);
  builder.devnet.mockResolvedValue(builder);
  return { builder, upload, applyConfig, getConfig, Uploader: vi.fn(() => builder) };
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
    expect(mocks.applyConfig).toHaveBeenCalledWith({
      url: mocks.builder.url,
      timeout: 120_000,
    });

    mocks.upload.mockResolvedValue({ id: 'tx-1' });
    await expect(
      uploader.upload(new Uint8Array([1, 2]), [{ name: 'App', value: 'vincent' }]),
    ).resolves.toEqual({ id: 'tx-1', uri: 'ar://tx-1' });
  });

  it('retries transient upload failures', async () => {
    vi.useFakeTimers();
    mocks.upload
      .mockRejectedValueOnce(new Error('read ETIMEDOUT'))
      .mockResolvedValueOnce({ id: 'tx-2' });

    const uploader = await createIrysDevnetUploader({
      privateKeyHex: '0x1234',
      rpcUrl: 'https://sepolia.base.org',
      maxUploadAttempts: 3,
      onUploadRetry: vi.fn(),
    });

    const uploadPromise = uploader.upload(new Uint8Array([1]), [{ name: 'App', value: 'vincent' }]);
    await vi.runAllTimersAsync();
    await expect(uploadPromise).resolves.toEqual({ id: 'tx-2', uri: 'ar://tx-2' });
    expect(mocks.upload).toHaveBeenCalledTimes(2);
    vi.useRealTimers();
  });
});
