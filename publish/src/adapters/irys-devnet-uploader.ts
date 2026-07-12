import { Buffer } from 'node:buffer';

import { createIrysDevnetClient } from './irys-devnet-client.js';
import type { UploadResult, UploadTag, Uploader as VincentUploader } from './types.js';

export interface IrysDevnetUploaderOptions {
  privateKeyHex: string;
  rpcUrl: string;
}

/** Irys devnet uploader using EVM wallet (founder-run CLI only). */
export async function createIrysDevnetUploader(
  options: IrysDevnetUploaderOptions,
): Promise<VincentUploader> {
  const irysUploader = await createIrysDevnetClient(options);

  return {
    async upload(data: Uint8Array, tags: UploadTag[]): Promise<UploadResult> {
      const receipt = await irysUploader.upload(Buffer.from(data), {
        tags: tags.map((tag) => ({ name: tag.name, value: tag.value })),
      });
      return { id: receipt.id, uri: `ar://${receipt.id}` };
    },
  };
}
