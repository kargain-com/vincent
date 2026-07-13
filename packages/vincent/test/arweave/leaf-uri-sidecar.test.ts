import { afterEach, describe, expect, it, vi } from 'vitest';

import {
  buildLeafUriSidecar,
  discoverLeafUriSidecar,
  fetchLeafUriSidecar,
  parseLeafUriSidecar,
  resolveVerifierLeafUris,
  serializeLeafUriSidecar,
  validateLeafUriSidecar,
} from '@kargain/vincent/arweave';
import { buildLeafUriSidecarTransactionQuery } from '../../src/arweave/irys-graphql.js';

const TEST_PUBLISHER = '0xa0e58EC0f3dF4f127e9203A7fd6a494c483719B3';
const MERKLE_ROOT = `sha256:${'a'.repeat(64)}`;
const JSONL_SHA = `sha256:${'b'.repeat(64)}`;
const GRAPHQL_URL = 'https://mock.uploader.irys.test/graphql';
const GATEWAY_URL = 'https://mock.gateway.irys.test';

const FINGERPRINT = {
  publisher: TEST_PUBLISHER,
  epoch: 2,
  merkleRoot: MERKLE_ROOT,
  jsonlSha256: JSONL_SHA,
};

afterEach(() => {
  vi.unstubAllGlobals();
});

function graphqlResponse(body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { 'content-type': 'application/json' },
  });
}

function graphqlRequestQuery(init?: RequestInit): string {
  const body = init?.body;
  if (typeof body !== 'string') {
    throw new Error('expected string graphql body');
  }
  return (JSON.parse(body) as { query: string }).query;
}

function fetchInputUrl(input: RequestInfo | URL): string {
  if (typeof input === 'string') {
    return input;
  }
  if (input instanceof URL) {
    return input.href;
  }
  return input.url;
}

describe('leaf uri sidecar', () => {
  it('buildLeafUriSidecarTransactionQuery honors explicit first', () => {
    const query = buildLeafUriSidecarTransactionQuery({
      publisher: TEST_PUBLISHER,
      epoch: 2,
      orderArgument: 'sort: HEIGHT_DESC',
      first: 5,
    });
    expect(query).toContain('first: 5');
    expect(query).toContain('"Kind", values: ["leaf-uris"]');

    const defaultFirst = buildLeafUriSidecarTransactionQuery({
      publisher: TEST_PUBLISHER,
      epoch: 2,
      orderArgument: 'sort: HEIGHT_DESC',
    });
    expect(defaultFirst).toContain('first: 1');
  });

  it('builds sorted leafUris and normalizes publisher', () => {
    const sidecar = buildLeafUriSidecar(FINGERPRINT, {
      '2GB': 'ar://tx-2',
      '1FA': 'ar://tx-1',
    });

    expect(sidecar.publisher).toBe(TEST_PUBLISHER.toLowerCase());
    expect(Object.keys(sidecar.leafUris)).toEqual(['1FA', '2GB']);
    expect(sidecar.leafUris['1FA']).toBe('ar://tx-1');
  });

  it('validates fingerprint binding', () => {
    const sidecar = buildLeafUriSidecar(FINGERPRINT, { '1FA': 'ar://tx-1' });
    expect(() => validateLeafUriSidecar(sidecar, FINGERPRINT)).not.toThrow();
    expect(() =>
      validateLeafUriSidecar(sidecar, { ...FINGERPRINT, epoch: 3 }),
    ).toThrow(/epoch mismatch/);
  });

  it('serializes with JCS canonical form', () => {
    const sidecar = buildLeafUriSidecar(FINGERPRINT, { '1FA': 'ar://tx-1' });
    const bytes = serializeLeafUriSidecar(sidecar);
    const parsed = parseLeafUriSidecar(JSON.parse(new TextDecoder().decode(bytes)));
    expect(parsed.leafUris).toEqual(sidecar.leafUris);
  });

  it('discovers newest sidecar tx via Kind tag', async () => {
    const fetchImpl: typeof fetch = async (_input, init) => {
      const query = graphqlRequestQuery(init);
      expect(query).toContain('"Kind"');
      expect(query).toContain('leaf-uris');
      return graphqlResponse({
        data: {
          transactions: {
            edges: [{ node: { id: 'tx-sidecar' } }],
          },
        },
      });
    };

    const result = await discoverLeafUriSidecar({
      graphqlUrl: GRAPHQL_URL,
      publisher: TEST_PUBLISHER,
      epoch: 2,
      fetchImpl,
    });

    expect(result).toEqual({ uri: 'ar://tx-sidecar' });
  });

  it('fetches sidecar from gateway and validates fingerprint', async () => {
    const sidecar = buildLeafUriSidecar(FINGERPRINT, { '1FA': 'ar://tx-1' });
    const fetchImpl: typeof fetch = async (input) => {
      expect(fetchInputUrl(input)).toContain('tx-sidecar');
      return new Response(JSON.stringify(sidecar), { status: 200 });
    };

    const fetched = await fetchLeafUriSidecar({
      gatewayUrl: GATEWAY_URL,
      uri: 'ar://tx-sidecar',
      fetchImpl,
      fingerprint: FINGERPRINT,
    });
    expect(fetched.leafUris).toEqual({ '1FA': 'ar://tx-1' });
  });

  it('fetches sidecar without fingerprint validation', async () => {
    const sidecar = buildLeafUriSidecar(FINGERPRINT, { '1FA': 'ar://tx-1' });
    const fetchImpl: typeof fetch = async () => new Response(JSON.stringify(sidecar), { status: 200 });
    const fetched = await fetchLeafUriSidecar({
      gatewayUrl: GATEWAY_URL,
      uri: 'ar://tx-sidecar',
      fetchImpl,
    });
    expect(fetched.leafUris).toEqual({ '1FA': 'ar://tx-1' });
  });

  it('discoverLeafUriSidecar uses global fetch when fetchImpl omitted', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () =>
        graphqlResponse({
          data: { transactions: { edges: [{ node: { id: 'tx-global' } }] } },
        }),
      ),
    );

    const result = await discoverLeafUriSidecar({
      graphqlUrl: GRAPHQL_URL,
      publisher: TEST_PUBLISHER,
      epoch: 2,
    });
    expect(result).toEqual({ uri: 'ar://tx-global' });
  });

  it('resolveVerifierLeafUris prefers explicit leafUris', async () => {
    const resolved = await resolveVerifierLeafUris({
      ...FINGERPRINT,
      gatewayUrl: GATEWAY_URL,
      graphqlUrl: GRAPHQL_URL,
      leafUris: { '1FA': 'ar://explicit' },
    });
    expect(resolved).toEqual({ '1FA': 'ar://explicit' });
  });

  it('resolveVerifierLeafUris discovers and fetches sidecar', async () => {
    const sidecar = buildLeafUriSidecar(FINGERPRINT, { '1FA': 'ar://tx-1' });
    const fetchImpl: typeof fetch = async (input, init) => {
      const url = fetchInputUrl(input);
      if (url === GRAPHQL_URL) {
        return graphqlResponse({
          data: { transactions: { edges: [{ node: { id: 'tx-sidecar' } }] } },
        });
      }
      expect(url).toContain('tx-sidecar');
      return new Response(JSON.stringify(sidecar), { status: 200 });
    };

    const resolved = await resolveVerifierLeafUris({
      ...FINGERPRINT,
      gatewayUrl: GATEWAY_URL,
      graphqlUrl: GRAPHQL_URL,
      fetchImpl,
    });
    expect(resolved).toEqual({ '1FA': 'ar://tx-1' });
  });

  it('rejects invalid build inputs', () => {
    expect(() =>
      buildLeafUriSidecar({ ...FINGERPRINT, merkleRoot: 'bad' }, {}),
    ).toThrow(/merkleRoot must be sha256/);
    expect(() => buildLeafUriSidecar({ ...FINGERPRINT, epoch: 0 }, {})).toThrow(
      /epoch must be a positive integer/,
    );
  });

  it('rejects invalid parse inputs', () => {
    expect(() => parseLeafUriSidecar(null)).toThrow(/must be an object/);
    expect(() => parseLeafUriSidecar({ schemaVersion: 2 })).toThrow(/schemaVersion/);
    expect(() => parseLeafUriSidecar({ schemaVersion: 1, publisher: '' })).toThrow(/publisher/);
    expect(() =>
      parseLeafUriSidecar({
        schemaVersion: 1,
        publisher: TEST_PUBLISHER,
        epoch: 0,
        merkleRoot: MERKLE_ROOT,
        jsonlSha256: JSONL_SHA,
        leafUris: {},
        updatedAt: 't',
      }),
    ).toThrow(/epoch must be a positive integer/);
    expect(() =>
      parseLeafUriSidecar({
        schemaVersion: 1,
        publisher: TEST_PUBLISHER,
        epoch: 2,
        merkleRoot: 1,
        jsonlSha256: JSONL_SHA,
        leafUris: {},
        updatedAt: 't',
      }),
    ).toThrow(/merkleRoot and jsonlSha256 are required/);
    expect(() =>
      parseLeafUriSidecar({
        schemaVersion: 1,
        publisher: TEST_PUBLISHER,
        epoch: 2,
        merkleRoot: MERKLE_ROOT,
        jsonlSha256: JSONL_SHA,
        leafUris: {},
        updatedAt: '',
      }),
    ).toThrow(/updatedAt is required/);
    expect(() =>
      parseLeafUriSidecar({
        schemaVersion: 1,
        publisher: TEST_PUBLISHER,
        epoch: 2,
        merkleRoot: MERKLE_ROOT,
        jsonlSha256: JSONL_SHA,
        leafUris: [],
        updatedAt: 't',
      }),
    ).toThrow(/leafUris must be an object/);
    expect(() =>
      parseLeafUriSidecar({
        schemaVersion: 1,
        publisher: TEST_PUBLISHER,
        epoch: 2,
        merkleRoot: MERKLE_ROOT,
        jsonlSha256: JSONL_SHA,
        leafUris: { '1FA': 'https://bad' },
        updatedAt: 't',
      }),
    ).toThrow(/must be an ar:\/\/ URI/);
  });

  it('validates publisher and merkle fingerprint mismatches', () => {
    const sidecar = buildLeafUriSidecar(FINGERPRINT, { '1FA': 'ar://tx-1' });
    expect(() =>
      validateLeafUriSidecar(sidecar, { ...FINGERPRINT, publisher: '0x' + 'c'.repeat(40) }),
    ).toThrow(/publisher mismatch/);
    expect(() =>
      validateLeafUriSidecar(sidecar, { ...FINGERPRINT, merkleRoot: `sha256:${'c'.repeat(64)}` }),
    ).toThrow(/merkleRoot\/jsonlSha256 mismatch/);
  });

  it('fetchLeafUriSidecar rejects non-ar URIs and HTTP errors', async () => {
    await expect(
      fetchLeafUriSidecar({ gatewayUrl: GATEWAY_URL, uri: 'https://bad' }),
    ).rejects.toThrow(/Expected ar:\/\/ URI/);

    const fetchImpl: typeof fetch = async () => new Response('', { status: 404 });
    await expect(
      fetchLeafUriSidecar({
        gatewayUrl: GATEWAY_URL,
        uri: 'ar://tx-sidecar',
        fetchImpl,
      }),
    ).rejects.toThrow(/Failed to fetch leaf uri sidecar: 404/);
  });

  it('discoverLeafUriSidecar returns null when no transactions', async () => {
    const fetchImpl: typeof fetch = async () =>
      graphqlResponse({ data: { transactions: { edges: [] } } });
    const result = await discoverLeafUriSidecar({
      graphqlUrl: GRAPHQL_URL,
      publisher: TEST_PUBLISHER,
      epoch: 2,
      fetchImpl,
    });
    expect(result).toBeNull();
  });

  it('discoverLeafUriSidecar throws on graphql errors', async () => {
    const fetchImpl: typeof fetch = async () =>
      graphqlResponse({ errors: [{ message: 'boom' }] });
    await expect(
      discoverLeafUriSidecar({
        graphqlUrl: GRAPHQL_URL,
        publisher: TEST_PUBLISHER,
        epoch: 2,
        fetchImpl,
      }),
    ).rejects.toThrow(/graphql query failed: boom/);
  });

  it('resolveVerifierLeafUris uses explicit sidecar URI', async () => {
    const sidecar = buildLeafUriSidecar(FINGERPRINT, { '1FA': 'ar://tx-1' });
    const fetchImpl: typeof fetch = async () => new Response(JSON.stringify(sidecar), { status: 200 });
    const resolved = await resolveVerifierLeafUris({
      ...FINGERPRINT,
      gatewayUrl: GATEWAY_URL,
      graphqlUrl: GRAPHQL_URL,
      leafUriSidecarUri: 'ar://tx-sidecar',
      fetchImpl,
    });
    expect(resolved).toEqual({ '1FA': 'ar://tx-1' });
  });

  it('resolveVerifierLeafUris returns undefined when discovery disabled or empty', async () => {
    expect(
      await resolveVerifierLeafUris({
        ...FINGERPRINT,
        gatewayUrl: GATEWAY_URL,
        graphqlUrl: GRAPHQL_URL,
        discoverLeafUriSidecar: false,
      }),
    ).toBeUndefined();

    const fetchImpl: typeof fetch = async () =>
      graphqlResponse({ data: { transactions: { edges: [] } } });
    expect(
      await resolveVerifierLeafUris({
        ...FINGERPRINT,
        gatewayUrl: GATEWAY_URL,
        graphqlUrl: GRAPHQL_URL,
        fetchImpl,
      }),
    ).toBeUndefined();
  });
});
