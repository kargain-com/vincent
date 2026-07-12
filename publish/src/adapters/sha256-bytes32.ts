import { isSha256Hash } from '../constants.js';

/** Convert protocol sha256 content id to bytes32 for on-chain calls. */
export function sha256ContentIdToBytes32(contentId: string): `0x${string}` {
  if (!isSha256Hash(contentId)) {
    throw new Error('content id must be sha256:<64 lowercase hex>');
  }
  return `0x${contentId.slice('sha256:'.length)}`;
}

/** Zero bytes32 for genesis parentRoot on-chain. */
export const ZERO_BYTES32 = `0x${'0'.repeat(64)}`;
