import { describe, expect, it } from 'vitest';

import golden from './fixtures/golden.json';
import { isValidChecksumAddress, toChecksumAddress } from '../../src/protocol/eip55.js';
import { recoverPersonalSignAddress } from '../../src/protocol/crypto.js';
import { signPersonalMessage } from '../../src/protocol/crypto.js';

describe('eip55', () => {
  it('validates checksummed addresses', () => {
    const address = golden.address;
    expect(isValidChecksumAddress(address)).toBe(true);
    expect(isValidChecksumAddress(address.toLowerCase())).toBe(false);
  });

  it('rejects malformed addresses for checksum validation', () => {
    expect(isValidChecksumAddress('0x1234')).toBe(false);
    expect(isValidChecksumAddress('not-an-address')).toBe(false);
  });

  it('throws on invalid toChecksumAddress input', () => {
    expect(() => toChecksumAddress('0x1234')).toThrow(RangeError);
  });
});

describe('crypto edge cases', () => {
  it('rejects invalid signature length on recovery', () => {
    expect(() => recoverPersonalSignAddress('hello', '0x1234')).toThrow(RangeError);
  });

  it('rejects private keys longer than 32 bytes', () => {
    const longKey = `0x${'11'.repeat(33)}`;
    expect(() => signPersonalMessage('test', longKey)).toThrow(RangeError);
  });
});
