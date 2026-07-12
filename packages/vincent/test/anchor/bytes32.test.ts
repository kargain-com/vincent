import { describe, expect, it } from 'vitest';

import {
  bytes32ParentRoot,
  bytes32ToContentId,
  ZERO_BYTES32,
} from '../../src/anchor/bytes32.js';

describe('bytes32ToContentId', () => {
  it('converts bytes32 to sha256 content id with lowercase hex', () => {
    expect(
      bytes32ToContentId(
        '0x76F6692120D6F8316AF6109AEE98F8C4782EF6111F2D16959745459DF0604F3C',
      ),
    ).toBe('sha256:76f6692120d6f8316af6109aee98f8c4782ef6111f2d16959745459df0604f3c');
  });
});

describe('bytes32ParentRoot', () => {
  it('maps zero bytes32 to null', () => {
    expect(bytes32ParentRoot(ZERO_BYTES32)).toBeNull();
  });

  it('maps non-zero bytes32 to sha256 content id', () => {
    expect(bytes32ParentRoot('0x0000000000000000000000000000000000000000000000000000000000000001')).toBe(
      'sha256:0000000000000000000000000000000000000000000000000000000000000001',
    );
  });
});
