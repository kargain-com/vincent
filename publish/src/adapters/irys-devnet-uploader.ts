import { BASE_SEPOLIA_CHAIN_ID } from '../constants.js';
import { createIrysUploader, type IrysUploaderOptions } from './irys-uploader.js';
import type { Uploader as VincentUploader } from './types.js';

export interface IrysDevnetUploaderOptions {
  privateKeyHex: string;
  rpcUrl: string;
  timeoutMs?: number;
  maxUploadAttempts?: number;
  onUploadRetry?: (info: { attempt: number; maxAttempts: number; error: unknown }) => void;
}

/** @deprecated Use {@link createIrysUploader} with chainId 84532. */
export async function createIrysDevnetUploader(
  options: IrysDevnetUploaderOptions,
): Promise<VincentUploader> {
  return createIrysUploader({ ...options, chainId: BASE_SEPOLIA_CHAIN_ID });
}

export { createIrysUploader, type IrysUploaderOptions } from './irys-uploader.js';
