import { decodeFromDataset } from './resolve.js';
import { openDatasetDb } from './sqlite-db.js';
import type { DecodeOptions, DecodeResult, Decoder } from './types.js';

/** Open a decoder over pre-verified compiler SQLite epoch bytes. */
export async function createDecoder(dataset: Uint8Array): Promise<Decoder> {
  const db = await openDatasetDb(dataset);

  return {
    decode(vin: string, options?: DecodeOptions): DecodeResult {
      return decodeFromDataset(db, vin, options);
    },
  };
}
