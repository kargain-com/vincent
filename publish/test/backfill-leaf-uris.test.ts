import { describe, expect, it } from 'vitest';

import { backfillLeafUrisFromGraphql } from '../src/backfill-leaf-uris.js';
import { mergeLeafUris, createEmptyCheckpoint } from '../src/publish-checkpoint.js';
import { TEST_PUBLISHER } from '../src/constants.js';

const GRAPHQL_URL = 'https://mock.uploader.irys.test/graphql';

function graphqlResponse(body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { 'content-type': 'application/json' },
  });
}

describe('backfillLeafUrisFromGraphql', () => {
  it('paginates owner+epoch queries and maps LeafKey tags to ar uris', async () => {
    let page = 0;
    const fetchImpl: typeof fetch = async (_input, init) => {
      const payload = JSON.parse(String(init?.body)) as { query: string };
      expect(payload.query).toContain('owners:');
      expect(payload.query).toContain('"Epoch"');
      expect(payload.query).not.toContain('LeafKey');
      page += 1;
      if (page === 1) {
        return graphqlResponse({
          data: {
            transactions: {
              pageInfo: { hasNextPage: true, endCursor: 'cursor-1' },
              edges: [
                {
                  cursor: 'cursor-1',
                  node: {
                    id: 'tx-old',
                    tags: [
                      { name: 'App', value: 'vincent' },
                      { name: 'Epoch', value: '2' },
                      { name: 'LeafKey', value: '1FA' },
                    ],
                  },
                },
                {
                  cursor: 'cursor-2',
                  node: {
                    id: 'tx-jsonl',
                    tags: [
                      { name: 'App', value: 'vincent' },
                      { name: 'Epoch', value: '2' },
                      { name: 'Type', value: 'jsonl' },
                    ],
                  },
                },
              ],
            },
          },
        });
      }
      return graphqlResponse({
        data: {
          transactions: {
            pageInfo: { hasNextPage: false, endCursor: null },
            edges: [
              {
                cursor: 'cursor-3',
                node: {
                  id: 'tx-new',
                  tags: [
                    { name: 'App', value: 'vincent' },
                    { name: 'Epoch', value: '2' },
                    { name: 'LeafKey', value: '1FA' },
                  ],
                },
              },
            ],
          },
        },
      });
    };

    const result = await backfillLeafUrisFromGraphql({
      graphqlUrl: GRAPHQL_URL,
      publisher: TEST_PUBLISHER,
      epoch: 2,
      fetchImpl,
      pageSize: 2,
    });

    expect(result.pagesFetched).toBe(2);
    expect(result.transactionsScanned).toBe(3);
    expect(result.leafUris).toEqual({ '1FA': 'ar://tx-old' });
  });

  it('merges into checkpoint without touching index-verified state', () => {
    const checkpoint = createEmptyCheckpoint({
      publisher: TEST_PUBLISHER,
      epochNumber: 2,
      merkleRoot: 'sha256:' + 'a'.repeat(64),
      jsonlSha256: 'sha256:' + 'b'.repeat(64),
    });
    const updated = mergeLeafUris(checkpoint, {
      '1FA': 'ar://tx-a',
      '2GB': 'ar://tx-b',
    });
    expect(updated.leafUris).toEqual({ '1FA': 'ar://tx-a', '2GB': 'ar://tx-b' });
    expect(updated.indexVerifiedLeafKeys).toEqual([]);
    expect(updated.failedLeafKeys).toEqual([]);
  });
});
