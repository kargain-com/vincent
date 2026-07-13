import { describe, expect, it } from 'vitest';

import * as arweaveEntry from '../../src/arweave-export.js';
import * as arweaveModule from '../../src/arweave/index.js';

describe('arweave entry re-exports', () => {
  it('exposes the public arweave API from both entry modules', () => {
    expect(typeof arweaveEntry.createArweaveGetLeaf).toBe('function');
    expect(typeof arweaveEntry.resolveLeafTxId).toBe('function');
    expect(typeof arweaveEntry.backfillLeafUrisFromGraphql).toBe('function');
    expect(typeof arweaveEntry.leafTxIdToUri).toBe('function');
    expect(typeof arweaveEntry.createArweaveGetLeafWithUris).toBe('function');
    expect(typeof arweaveEntry.fetchLeafFromGateway).toBe('function');
    expect(typeof arweaveEntry.verifyLeafFromGateway).toBe('function');
    expect(arweaveEntry.LeafNotFoundError).toBe(arweaveModule.LeafNotFoundError);
    expect(arweaveEntry.createArweaveGetLeaf).toBe(arweaveModule.createArweaveGetLeaf);
    expect(arweaveEntry.resolveLeafTxId).toBe(arweaveModule.resolveLeafTxId);
    expect(arweaveEntry.backfillLeafUrisFromGraphql).toBe(arweaveModule.backfillLeafUrisFromGraphql);
    expect(arweaveEntry.fetchLeafFromGateway).toBe(arweaveModule.fetchLeafFromGateway);
    expect(arweaveEntry.createArweaveGetLeafWithUris).toBe(arweaveModule.createArweaveGetLeafWithUris);
    expect(arweaveEntry.verifyLeafFromGateway).toBe(arweaveModule.verifyLeafFromGateway);
  });
});
