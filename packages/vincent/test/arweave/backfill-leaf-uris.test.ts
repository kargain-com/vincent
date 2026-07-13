import { afterEach, describe, expect, it, vi } from 'vitest';

import { backfillLeafUrisFromGraphql } from '@kargain/vincent/arweave';

const TEST_PUBLISHER = '0xa0e58EC0f3dF4f127e9203A7fd6a494c483719B3';
const GRAPHQL_URL = 'https://mock.uploader.irys.test/graphql';

afterEach(() => {
  vi.unstubAllGlobals();
});

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

  it('falls back to sort: HEIGHT_DESC when order is unsupported', async () => {
    let call = 0;
    const fetchImpl: typeof fetch = async () => {
      call += 1;
      if (call === 1) {
        return graphqlResponse({
          errors: [{ message: 'Unknown argument "order" on field "Query.transactions".' }],
        });
      }
      return graphqlResponse({
        data: {
          transactions: {
            pageInfo: { hasNextPage: false, endCursor: null },
            edges: [
              {
                cursor: 'cursor-1',
                node: {
                  id: 'tx-1',
                  tags: [
                    { name: 'App', value: 'vincent' },
                    { name: 'Epoch', value: '1' },
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
      epoch: 1,
      fetchImpl,
    });

    expect(call).toBe(2);
    expect(result.leafUris).toEqual({ '1FA': 'ar://tx-1' });
  });

  it('throws when GraphQL returns errors', async () => {
    const fetchImpl: typeof fetch = () =>
      Promise.resolve(
        graphqlResponse({ errors: [{ message: 'upstream failure' }] }),
      );

    await expect(
      backfillLeafUrisFromGraphql({
        graphqlUrl: GRAPHQL_URL,
        publisher: TEST_PUBLISHER,
        epoch: 1,
        fetchImpl,
      }),
    ).rejects.toThrow('graphql query failed: upstream failure');
  });

  it('throws when transactions are missing from the response', async () => {
    const fetchImpl: typeof fetch = () => Promise.resolve(graphqlResponse({ data: {} }));

    await expect(
      backfillLeafUrisFromGraphql({
        graphqlUrl: GRAPHQL_URL,
        publisher: TEST_PUBLISHER,
        epoch: 1,
        fetchImpl,
      }),
    ).rejects.toThrow('graphql response missing transactions');
  });

  it('throws when transactions lack pagination fields', async () => {
    const fetchImpl: typeof fetch = () =>
      Promise.resolve(
        graphqlResponse({
          data: { transactions: { edges: [{ node: { id: 'tx-1', tags: [] } }] } },
        }),
      );

    await expect(
      backfillLeafUrisFromGraphql({
        graphqlUrl: GRAPHQL_URL,
        publisher: TEST_PUBLISHER,
        epoch: 1,
        fetchImpl,
      }),
    ).rejects.toThrow('graphql response missing transactions');
  });

  it('uses global fetch when fetchImpl is omitted', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () =>
        Promise.resolve(
          graphqlResponse({
            data: {
              transactions: {
                pageInfo: { hasNextPage: false, endCursor: null },
                edges: [
                  {
                    cursor: 'cursor-1',
                    node: {
                      id: 'tx-global',
                      tags: [
                        { name: 'App', value: 'vincent' },
                        { name: 'Epoch', value: '1' },
                        { name: 'LeafKey', value: '1FA' },
                      ],
                    },
                  },
                ],
              },
            },
          }),
        ),
      ),
    );

    const result = await backfillLeafUrisFromGraphql({
      graphqlUrl: GRAPHQL_URL,
      publisher: TEST_PUBLISHER,
      epoch: 1,
    });

    expect(result.leafUris).toEqual({ '1FA': 'ar://tx-global' });
  });
});
