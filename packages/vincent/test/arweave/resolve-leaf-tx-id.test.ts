import { afterEach, describe, expect, it, vi } from 'vitest';

import { leafTxIdToUri, resolveLeafTxId } from '@kargain/vincent/arweave';

const TEST_PUBLISHER = '0xa0e58EC0f3dF4f127e9203A7fd6a494c483719B3';

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('resolveLeafTxId', () => {
  it('returns the newest tx id for a tagged leaf', async () => {
    const fetchImpl: typeof fetch = async (_input, init) => {
      const payload = JSON.parse(String(init?.body)) as { query: string };
      expect(payload.query).toContain('LeafKey');
      return new Response(
        JSON.stringify({ data: { transactions: { edges: [{ node: { id: 'mock-tx-1' } }] } } }),
        { status: 200 },
      );
    };

    const txId = await resolveLeafTxId({
      graphqlUrl: 'https://mock.uploader.irys.test/graphql',
      publisher: TEST_PUBLISHER,
      epoch: 1,
      leafKey: '1FA',
      fetchImpl,
    });

    expect(txId).toBe('mock-tx-1');
    expect(leafTxIdToUri(txId!)).toBe('ar://mock-tx-1');
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

  it('lowercases checksummed publisher in owners filter', async () => {
    let capturedQuery = '';
    const fetchImpl: typeof fetch = async (_input, init) => {
      const payload = JSON.parse(String(init?.body)) as { query: string };
      capturedQuery = payload.query;
      return new Response(
        JSON.stringify({ data: { transactions: { edges: [{ node: { id: 'mock-tx-1' } }] } } }),
        { status: 200 },
      );
    };

    await resolveLeafTxId({
      graphqlUrl: 'https://mock.uploader.irys.test/graphql',
      publisher: '0xCf1Eb0E7ed453Ed266bF90E7C09e0E4769580b77',
      epoch: 2,
      leafKey: '1FA',
      fetchImpl,
    });

    expect(capturedQuery).toContain('"0xcf1eb0e7ed453ed266bf90e7c09e0e4769580b77"');
  });

  it('throws when GraphQL returns errors', async () => {
    const fetchImpl: typeof fetch = () =>
      Promise.resolve(
        new Response(
          JSON.stringify({ errors: [{ message: 'Query execution timed out' }] }),
          { status: 200 },
        ),
      );

    await expect(
      resolveLeafTxId({
        graphqlUrl: 'https://mock.uploader.irys.test/graphql',
        publisher: TEST_PUBLISHER,
        epoch: 1,
        leafKey: '1FA',
        fetchImpl,
      }),
    ).rejects.toThrow('graphql query failed: Query execution timed out');
  });

  it('uses global fetch when fetchImpl is omitted', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () =>
        Promise.resolve(
          new Response(
            JSON.stringify({ data: { transactions: { edges: [{ node: { id: 'global-tx' } }] } } }),
            { status: 200 },
          ),
        ),
      ),
    );

    const txId = await resolveLeafTxId({
      graphqlUrl: 'https://mock.uploader.irys.test/graphql',
      publisher: TEST_PUBLISHER,
      epoch: 1,
      leafKey: '1FA',
    });

    expect(txId).toBe('global-tx');
  });
});

describe('leafTxIdToUri', () => {
  it('passes through ar:// URIs', () => {
    expect(leafTxIdToUri('ar://tx-1')).toBe('ar://tx-1');
    expect(leafTxIdToUri('tx-1')).toBe('ar://tx-1');
  });
});
