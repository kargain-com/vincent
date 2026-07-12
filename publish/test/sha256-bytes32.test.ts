import { describe, expect, it } from 'vitest';

import { sha256ContentIdToBytes32, ZERO_BYTES32 } from '../src/adapters/sha256-bytes32.js';

describe('sha256ContentIdToBytes32', () => {
  it('strips sha256 prefix', () => {
    const id = 'sha256:0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef';
    expect(sha256ContentIdToBytes32(id)).toBe(
      '0x0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef',
    );
  });

  it('rejects invalid content ids', () => {
    expect(() => sha256ContentIdToBytes32('bad')).toThrow(/sha256:/);
  });

  it('exposes zero bytes32', () => {
    expect(ZERO_BYTES32).toBe(`0x${'0'.repeat(64)}`);
  });
});
