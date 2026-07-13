import { Buffer } from 'node:buffer';

import { IRYS_UPLOAD_MAX_ATTEMPTS } from '../constants.js';
import { createIrysClient } from './irys-client.js';
import { withIrysUploadRetries } from './irys-upload-retry.js';
import type { UploadResult, UploadTag, Uploader as VincentUploader } from './types.js';

export interface IrysUploaderOptions {
  chainId: number;
  privateKeyHex: string;
  rpcUrl: string;
  timeoutMs?: number;
  maxUploadAttempts?: number;
  onUploadRetry?: (info: { attempt: number; maxAttempts: number; error: unknown }) => void;
}

/** Irys uploader using EVM wallet on Base Sepolia or Base mainnet. */
export async function createIrysUploader(
  options: IrysUploaderOptions,
): Promise<VincentUploader> {
  const irysUploader = await createIrysClient(options);
  const maxAttempts = options.maxUploadAttempts ?? IRYS_UPLOAD_MAX_ATTEMPTS;

  return {
    async upload(data: Uint8Array, tags: UploadTag[]): Promise<UploadResult> {
      const receipt = await withIrysUploadRetries(
        () =>
          irysUploader.upload(Buffer.from(data), {
            tags: tags.map((tag) => ({ name: tag.name, value: tag.value })),
          }),
        {
          maxAttempts,
          onRetry: options.onUploadRetry,
        },
      );
      return { id: receipt.id, uri: `ar://${receipt.id}` };
    },
  };
}
