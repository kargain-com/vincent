import { describe, expect, it } from 'vitest';

import * as anchorEntry from '../../src/anchor-export.js';
import * as anchorModule from '../../src/anchor/index.js';

describe('anchor entry re-exports', () => {
  it('exposes the public anchor API from both entry modules', () => {
    expect(typeof anchorEntry.createAnchorReader).toBe('function');
    expect(anchorEntry.createAnchorReader).toBe(anchorModule.createAnchorReader);
    expect(anchorEntry.DEFAULT_REGISTRY_ADDRESS).toBe(anchorModule.DEFAULT_REGISTRY_ADDRESS);
    expect(anchorEntry.REGISTRY_ABI).toBe(anchorModule.REGISTRY_ABI);
    expect(anchorEntry.bytes32ToContentId).toBe(anchorModule.bytes32ToContentId);
    expect(anchorEntry.bytes32ParentRoot).toBe(anchorModule.bytes32ParentRoot);
    expect(anchorEntry.ZERO_BYTES32).toBe(anchorModule.ZERO_BYTES32);
  });
});
