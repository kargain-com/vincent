import { compile } from '@kargain/vincent-compiler';
import { describe, expect, it } from 'vitest';

import { TEST_PUBLISHER } from '../src/constants.js';
import { leafTxIdToUri, resolveLeafTxId } from '../src/resolve-leaf-tx-id.js';
import { loadGenesisMiniClaims } from './helpers.js';
import { createLiveMockIrysFetchImpl } from './live-mock-irys-fetch.js';
import { createMockUploader } from './mock-uploader.js';

describe('resolveLeafTxId', () => {
  it('returns the newest tx id for a tagged leaf', async () => {
    const built = compile(loadGenesisMiniClaims(), {});
    if (!built.ok) {
      throw new Error(built.error.message);
    }

    const uploader = createMockUploader();
    const sortedLeaves = [...built.value.leaves.entries()].sort(([a], [b]) => a.localeCompare(b));
    const firstLeaf = sortedLeaves[0];
    if (firstLeaf === undefined) {
      throw new Error('expected at least one leaf');
    }
    const [leafKey, entry] = firstLeaf;
    await uploader.upload(
      new TextEncoder().encode(JSON.stringify({ leaf: entry.leaf, proof: entry.proof })),
      [
        { name: 'App', value: 'vincent' },
        { name: 'Epoch', value: '1' },
        { name: 'LeafKey', value: leafKey },
      ],
    );

    const live = createLiveMockIrysFetchImpl(uploader, TEST_PUBLISHER, 1);
    const txId = await resolveLeafTxId({
      graphqlUrl: live.graphqlUrl,
      publisher: TEST_PUBLISHER,
      epoch: 1,
      leafKey,
      fetchImpl: live.fetchImpl,
    });

    expect(txId).toMatch(/^mock-/);
    expect(leafTxIdToUri(txId!)).toBe(`ar://${txId}`);
  });

  it('returns null when GraphQL has no match', async () => {
    const fetchImpl: typeof fetch = () =>
      Promise.resolve(
        new Response(JSON.stringify({ data: { transactions: { edges: [] } } }), { status: 200 }),
      );

    const txId = await resolveLeafTxId({
      graphqlUrl: 'https://mock.uploader.irys.test/graphql',
      publisher: TEST_PUBLISHER,
      epoch: 1,
      leafKey: '1FA',
      fetchImpl,
    });

    expect(txId).toBeNull();
  });
});
