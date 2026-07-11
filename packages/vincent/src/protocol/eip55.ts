import { toChecksumAddress } from './crypto.js';

/** Return true when address matches EIP-55 checksum encoding. */
export function isValidChecksumAddress(address: string): boolean {
  if (!/^0x[0-9a-fA-F]{40}$/.test(address)) {
    return false;
  }
  return toChecksumAddress(address) === address;
}

export { toChecksumAddress } from './crypto.js';
