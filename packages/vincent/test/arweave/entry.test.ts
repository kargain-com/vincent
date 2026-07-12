import { describe, expect, it } from 'vitest';

import * as arweaveEntry from '../../src/arweave-export.js';
import * as arweaveModule from '../../src/arweave/index.js';

describe('arweave entry re-exports', () => {
  it('exposes the public arweave API from both entry modules', () => {
    expect(typeof arweaveEntry.createArweaveGetLeaf).toBe('function');
    expect(arweaveEntry.LeafNotFoundError).toBe(arweaveModule.LeafNotFoundError);
    expect(arweaveEntry.createArweaveGetLeaf).toBe(arweaveModule.createArweaveGetLeaf);
  });
});
