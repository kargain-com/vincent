import { describe, expect, it } from 'vitest';

import type { MerkleProof } from '@kargain/vincent/decoder';

import { createArweaveGetLeaf, LeafNotFoundError } from '@kargain/vincent/arweave';
import { createMockGateway, requestUrl } from './mock-gateway.js';

const EDGE_HIT = JSON.stringify({
  data: { transactions: { edges: [{ node: { id: 'tx-1' } }] } },
});

function graphqlThen(leafResponse: () => Response): typeof fetch {
  return (input) => {
    const url = requestUrl(input);
    if (url.endsWith('/graphql')) {
      return Promise.resolve(new Response(EDGE_HIT, { status: 200 }));
    }
    return Promise.resolve(leafResponse());
  };
}

const PUBLISHER = '0xa0e58EC0f3dF4f127e9203A7fd6a494c483719B3';
const LEAF = '{"wmi":"1FA","bindings":[],"schemas":{}}';
const PROOF: MerkleProof = [{ hash: 'sha256:abc', side: 'right' }];

describe('createArweaveGetLeaf', () => {
  it('returns tagged leaf and proof', async () => {
    const { gatewayUrl, fetchImpl } = createMockGateway([
      {
        owner: PUBLISHER,
        epoch: 1,
        leafKey: '1FA',
        txId: 'tx-1fa',
        height: 100,
        data: { leaf: LEAF, proof: PROOF },
      },
    ]);

    const getLeaf = createArweaveGetLeaf({
      gatewayUrl,
      publisher: PUBLISHER,
      epoch: 1,
      fetchImpl,
    });

    await expect(getLeaf('1FA')).resolves.toEqual({ leaf: LEAF, proof: PROOF });
  });

  it('ignores items from other owners', async () => {
    const { gatewayUrl, fetchImpl } = createMockGateway([
      {
        owner: '0x0000000000000000000000000000000000000001',
        epoch: 1,
        leafKey: '1FA',
        txId: 'tx-wrong-owner',
        height: 200,
        data: { leaf: 'wrong', proof: PROOF },
      },
    ]);

    const getLeaf = createArweaveGetLeaf({
      gatewayUrl,
      publisher: PUBLISHER,
      epoch: 1,
      fetchImpl,
    });

    await expect(getLeaf('1FA')).rejects.toBeInstanceOf(LeafNotFoundError);
  });

  it('throws LeafNotFoundError when no item matches', async () => {
    const { gatewayUrl, fetchImpl } = createMockGateway([]);

    const getLeaf = createArweaveGetLeaf({
      gatewayUrl,
      publisher: PUBLISHER,
      epoch: 1,
      fetchImpl,
    });

    await expect(getLeaf('VF3')).rejects.toMatchObject({
      name: 'LeafNotFoundError',
      message: 'missing leaf for LeafKey: VF3',
    });
  });

  it('selects the newest item when multiple matches exist', async () => {
    const { gatewayUrl, fetchImpl } = createMockGateway([
      {
        owner: PUBLISHER,
        epoch: 1,
        leafKey: '1FA',
        txId: 'tx-old',
        height: 10,
        data: { leaf: 'old-leaf', proof: PROOF },
      },
      {
        owner: PUBLISHER,
        epoch: 1,
        leafKey: '1FA',
        txId: 'tx-new',
        height: 99,
        data: { leaf: 'new-leaf', proof: PROOF },
      },
    ]);

    const getLeaf = createArweaveGetLeaf({
      gatewayUrl,
      publisher: PUBLISHER,
      epoch: 1,
      fetchImpl,
    });

    await expect(getLeaf('1FA')).resolves.toEqual({ leaf: 'new-leaf', proof: PROOF });
  });

  it('normalizes trailing slashes on gatewayUrl', async () => {
    const { gatewayUrl, fetchImpl } = createMockGateway([
      {
        owner: PUBLISHER,
        epoch: 1,
        leafKey: '1FA',
        txId: 'tx-1fa',
        height: 1,
        data: { leaf: LEAF, proof: PROOF },
      },
    ]);

    const getLeaf = createArweaveGetLeaf({
      gatewayUrl: `${gatewayUrl}/`,
      publisher: PUBLISHER,
      epoch: 1,
      fetchImpl,
    });

    await expect(getLeaf('1FA')).resolves.toEqual({ leaf: LEAF, proof: PROOF });
  });

  it('propagates graphql HTTP errors', async () => {
    const fetchImpl: typeof fetch = () => Promise.resolve(new Response('error', { status: 500 }));

    const getLeaf = createArweaveGetLeaf({
      gatewayUrl: 'https://mock.arweave.test',
      publisher: PUBLISHER,
      epoch: 1,
      fetchImpl,
    });

    await expect(getLeaf('1FA')).rejects.toThrow('graphql request failed: 500');
  });

  it('rejects non-JSON graphql responses with HTTP 200', async () => {
    const fetchImpl: typeof fetch = () => Promise.resolve(new Response('not-json', { status: 200 }));

    const getLeaf = createArweaveGetLeaf({
      gatewayUrl: 'https://mock.arweave.test',
      publisher: PUBLISHER,
      epoch: 1,
      fetchImpl,
    });

    await expect(getLeaf('1FA')).rejects.toThrow('graphql response was not valid JSON');
  });

  it('propagates HTTP errors when the JSON body is not a sort/order schema mismatch', async () => {
    const fetchImpl: typeof fetch = () =>
      Promise.resolve(
        new Response(JSON.stringify({ errors: [{ message: 'Internal server error' }] }), {
          status: 500,
        }),
      );

    const getLeaf = createArweaveGetLeaf({
      gatewayUrl: 'https://mock.arweave.test',
      publisher: PUBLISHER,
      epoch: 1,
      fetchImpl,
    });

    await expect(getLeaf('1FA')).rejects.toThrow('graphql request failed: 500');
  });

  it('propagates leaf data HTTP errors', async () => {
    const fetchImpl = graphqlThen(() => new Response('missing', { status: 404 }));

    const getLeaf = createArweaveGetLeaf({
      gatewayUrl: 'https://mock.arweave.test',
      publisher: PUBLISHER,
      epoch: 1,
      fetchImpl,
    });

    await expect(getLeaf('1FA')).rejects.toThrow('leaf data fetch failed: 404');
  });

  it('rejects invalid leaf payload shape', async () => {
    const fetchImpl = graphqlThen(
      () => new Response(JSON.stringify({ bad: true }), { status: 200 }),
    );

    const getLeaf = createArweaveGetLeaf({
      gatewayUrl: 'https://mock.arweave.test',
      publisher: PUBLISHER,
      epoch: 1,
      fetchImpl,
    });

    await expect(getLeaf('1FA')).rejects.toThrow('leaf data must contain leaf and proof');
  });

  it('rejects non-object leaf payload', async () => {
    const fetchImpl = graphqlThen(() => new Response('[]', { status: 200 }));

    const getLeaf = createArweaveGetLeaf({
      gatewayUrl: 'https://mock.arweave.test',
      publisher: PUBLISHER,
      epoch: 1,
      fetchImpl,
    });

    await expect(getLeaf('1FA')).rejects.toThrow('leaf data must be a JSON object');
  });

  it('uses global fetch when fetchImpl is omitted', async () => {
    const { gatewayUrl, fetchImpl } = createMockGateway([
      {
        owner: PUBLISHER,
        epoch: 1,
        leafKey: '1FA',
        txId: 'tx-1fa',
        height: 1,
        data: { leaf: LEAF, proof: PROOF },
      },
    ]);

    const originalFetch = globalThis.fetch;
    globalThis.fetch = fetchImpl;
    try {
      const getLeaf = createArweaveGetLeaf({
        gatewayUrl,
        publisher: PUBLISHER,
        epoch: 1,
      });
      await expect(getLeaf('1FA')).resolves.toEqual({ leaf: LEAF, proof: PROOF });
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  it('rejects invalid leaf and proof field types', async () => {
    const fetchImpl = graphqlThen(
      () => new Response(JSON.stringify({ leaf: 1, proof: 'bad' }), { status: 200 }),
    );

    const getLeaf = createArweaveGetLeaf({
      gatewayUrl: 'https://mock.arweave.test',
      publisher: PUBLISHER,
      epoch: 1,
      fetchImpl,
    });

    await expect(getLeaf('1FA')).rejects.toThrow('leaf must be a string or Uint8Array');
  });

  it('rejects non-array proof', async () => {
    const fetchImpl = graphqlThen(
      () => new Response(JSON.stringify({ leaf: LEAF, proof: null }), { status: 200 }),
    );

    const getLeaf = createArweaveGetLeaf({
      gatewayUrl: 'https://mock.arweave.test',
      publisher: PUBLISHER,
      epoch: 1,
      fetchImpl,
    });

    await expect(getLeaf('1FA')).rejects.toThrow('proof must be an array');
  });

  it('uses order: DESC on Irys GraphQL without attempting sort', async () => {
    const gatewayUrl = 'https://gateway.irys.test';
    const graphqlUrl = 'https://uploader.irys.test/graphql';
    const queries: string[] = [];
    const fetchImpl: typeof fetch = (input, init) => {
      const url = requestUrl(input);
      if (url === graphqlUrl) {
        const body = typeof init?.body === 'string' ? init.body : '';
        const query = (JSON.parse(body) as { query: string }).query;
        queries.push(query);
        return Promise.resolve(new Response(EDGE_HIT, { status: 200 }));
      }
      return Promise.resolve(
        new Response(JSON.stringify({ leaf: LEAF, proof: PROOF }), { status: 200 }),
      );
    };

    const getLeaf = createArweaveGetLeaf({
      gatewayUrl,
      graphqlUrl,
      publisher: PUBLISHER,
      epoch: 1,
      fetchImpl,
    });

    await expect(getLeaf('1FA')).resolves.toEqual({ leaf: LEAF, proof: PROOF });
    expect(queries).toHaveLength(1);
    expect(queries[0]).toContain('order: DESC');
    expect(queries[0]).not.toContain('sort: HEIGHT_DESC');
  });

  it('falls back to sort when order returns HTTP 400 on Arweave gateways', async () => {
    const gatewayUrl = 'https://gateway.irys.test';
    const graphqlUrl = 'https://arweave.test/graphql';
    const queries: string[] = [];
    const fetchImpl: typeof fetch = (input, init) => {
      const url = requestUrl(input);
      if (url === graphqlUrl) {
        const body = typeof init?.body === 'string' ? init.body : '';
        const query = (JSON.parse(body) as { query: string }).query;
        queries.push(query);
        if (query.includes('order: DESC')) {
          return Promise.resolve(
            new Response(
              JSON.stringify({
                errors: [{ message: 'Unknown argument "order" on field "Query.transactions".' }],
              }),
              { status: 400 },
            ),
          );
        }
        return Promise.resolve(new Response(EDGE_HIT, { status: 200 }));
      }
      return Promise.resolve(
        new Response(JSON.stringify({ leaf: LEAF, proof: PROOF }), { status: 200 }),
      );
    };

    const getLeaf = createArweaveGetLeaf({
      gatewayUrl,
      graphqlUrl,
      publisher: PUBLISHER,
      epoch: 1,
      fetchImpl,
    });

    await expect(getLeaf('1FA')).resolves.toEqual({ leaf: LEAF, proof: PROOF });
    expect(queries).toHaveLength(2);
    expect(queries[0]).toContain('order: DESC');
    expect(queries[1]).toContain('sort: HEIGHT_DESC');
  });

  it('does not fail when sort would return HTTP 400 because order is tried first', async () => {
    const gatewayUrl = 'https://gateway.irys.test';
    const graphqlUrl = 'https://uploader.irys.test/graphql';
    const fetchImpl: typeof fetch = (input, init) => {
      const url = requestUrl(input);
      if (url === graphqlUrl) {
        const body = typeof init?.body === 'string' ? init.body : '';
        const query = (JSON.parse(body) as { query: string }).query;
        if (query.includes('sort: HEIGHT_DESC')) {
          return Promise.resolve(
            new Response(
              JSON.stringify({
                errors: [{ message: 'Unknown argument "sort" on field "Query.transactions".' }],
              }),
              { status: 400 },
            ),
          );
        }
        return Promise.resolve(new Response(EDGE_HIT, { status: 200 }));
      }
      return Promise.resolve(
        new Response(JSON.stringify({ leaf: LEAF, proof: PROOF }), { status: 200 }),
      );
    };

    const getLeaf = createArweaveGetLeaf({
      gatewayUrl,
      graphqlUrl,
      publisher: PUBLISHER,
      epoch: 1,
      fetchImpl,
    });

    await expect(getLeaf('1FA')).resolves.toEqual({ leaf: LEAF, proof: PROOF });
  });

  it('surfaces GraphQL errors instead of reporting a missing leaf', async () => {
    const fetchImpl: typeof fetch = () =>
      Promise.resolve(
        new Response(
          JSON.stringify({ errors: [{ message: 'Query execution timed out' }] }),
          { status: 200 },
        ),
      );
    const getLeaf = createArweaveGetLeaf({
      gatewayUrl: 'https://mock.arweave.test',
      publisher: PUBLISHER,
      epoch: 1,
      fetchImpl,
    });

    await expect(getLeaf('1FA')).rejects.toThrow(
      'graphql query failed: Query execution timed out',
    );
  });
});
