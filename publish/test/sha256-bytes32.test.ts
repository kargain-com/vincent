import { describe, expect, it } from 'vitest';

import { bytes32ToContentId, sha256ContentIdToBytes32 } from '../src/adapters/sha256-bytes32.js';

describe('sha256-bytes32', () => {
  it('round-trips content id and bytes32', () => {
    const contentId = 'sha256:abcdef0123456789abcdef0123456789abcdef0123456789abcdef0123456789';
    const bytes32 = sha256ContentIdToBytes32(contentId);
    expect(bytes32ToContentId(bytes32)).toBe(contentId);
  });

  it('rejects invalid content id for bytes32 conversion', () => {
    expect(() => sha256ContentIdToBytes32('not-a-hash')).toThrow(/sha256/);
  });
});
