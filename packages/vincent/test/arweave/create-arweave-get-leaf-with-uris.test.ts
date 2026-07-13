import { compile } from '@kargain/vincent-compiler';
import { createArweaveGetLeafWithUris } from '@kargain/vincent/arweave';
import { createDecoder } from '@kargain/vincent/decoder';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { loadGenesisMiniClaims, VIN_2011 } from '../decoder/helpers.js';
import { createMockGateway, type MockGatewayItem } from './mock-gateway.js';

const GRAPHQL_URL = 'https://mock.uploader.irys.test/graphql';
const GATEWAY_URL = 'https://mock.gateway.irys.test';

function buildGenesisMiniArtifacts(): {
  merkleRoot: string;
  leafUris: Record<string, string>;
  staticBodies: Record<string, string>;
  items: MockGatewayItem[];
} {
  const built = compile(loadGenesisMiniClaims(), {});
  if (!built.ok) {
    throw new Error(built.error.message);
  }

  const leafUris: Record<string, string> = {};
  const staticBodies: Record<string, string> = {};
  const items: MockGatewayItem[] = [];

  for (const [leafKey, entry] of built.value.leaves.entries()) {
    const txId = `tx-${leafKey}`;
    const body = JSON.stringify({ leaf: entry.leaf, proof: entry.proof });
    leafUris[leafKey] = `ar://${txId}`;
    staticBodies[txId] = body;
    items.push({
      owner: '0xowner',
      epoch: 1,
      leafKey,
      txId,
      height: items.length + 1,
      data: { leaf: entry.leaf, proof: entry.proof },
    });
  }

  return {
    merkleRoot: built.value.merkleRoot,
    leafUris,
    staticBodies,
    items,
  };
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('createArweaveGetLeafWithUris', () => {
  it('decodes via gateway when per-LeafKey GraphQL is empty', async () => {
    const { merkleRoot, leafUris, staticBodies } = buildGenesisMiniArtifacts();
    const { gatewayUrl, graphqlUrl, fetchImpl } = createMockGateway([], {
      gatewayUrl: GATEWAY_URL,
      graphqlUrl: GRAPHQL_URL,
      staticBodies,
    });

    const decoder = createDecoder({
      merkleRoot,
      getLeaf: createArweaveGetLeafWithUris({
        gatewayUrl,
        graphqlUrl,
        publisher: '0xowner',
        epoch: 1,
        fetchImpl,
        leafUris,
      }),
    });

    const result = await decoder.decode(VIN_2011, { year: 2011 });
    expect(result.year.value).toBe(2011);
  });

  it('falls back to GraphQL when leafUris entry is missing', async () => {
    const { merkleRoot, items } = buildGenesisMiniArtifacts();
    const { gatewayUrl, graphqlUrl, fetchImpl } = createMockGateway(items, {
      gatewayUrl: GATEWAY_URL,
      graphqlUrl: GRAPHQL_URL,
    });

    const decoder = createDecoder({
      merkleRoot,
      getLeaf: createArweaveGetLeafWithUris({
        gatewayUrl,
        graphqlUrl,
        publisher: '0xowner',
        epoch: 1,
        fetchImpl,
      }),
    });

    const result = await decoder.decode(VIN_2011, { year: 2011 });
    expect(result.year.value).toBe(2011);
  });

  it('falls back to GraphQL when gateway fetch for a known uri fails', async () => {
    const { merkleRoot, leafUris, items } = buildGenesisMiniArtifacts();
    const leafKey = Object.keys(leafUris)[0];
    if (leafKey === undefined) {
      throw new Error('expected leaf uris');
    }
    const badUris = { ...leafUris, [leafKey]: 'ar://missing-tx' };

    const { gatewayUrl, graphqlUrl, fetchImpl } = createMockGateway(items, {
      gatewayUrl: GATEWAY_URL,
      graphqlUrl: GRAPHQL_URL,
    });

    const decoder = createDecoder({
      merkleRoot,
      getLeaf: createArweaveGetLeafWithUris({
        gatewayUrl,
        graphqlUrl,
        publisher: '0xowner',
        epoch: 1,
        fetchImpl,
        leafUris: badUris,
      }),
    });

    const result = await decoder.decode(VIN_2011, { year: 2011 });
    expect(result.year.value).toBe(2011);
  });

  it('uses global fetch when fetchImpl is omitted', async () => {
    const { leafUris, staticBodies } = buildGenesisMiniArtifacts();
    const firstKey = Object.keys(leafUris)[0];
    const firstUri = firstKey === undefined ? undefined : leafUris[firstKey];
    if (firstUri === undefined) {
      throw new Error('expected leaf uri');
    }
    const txId = firstUri.slice('ar://'.length);
    const body = staticBodies[txId];
    if (body === undefined) {
      throw new Error('expected static body');
    }

    vi.stubGlobal(
      'fetch',
      vi.fn(async (input: RequestInfo | URL) => {
        const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
        if (url.includes('/graphql')) {
          return new Response(JSON.stringify({ data: { transactions: { edges: [] } } }), {
            status: 200,
          });
        }
        return new Response(body, { status: 200, headers: { 'content-type': 'application/json' } });
      }),
    );

    const getLeaf = createArweaveGetLeafWithUris({
      gatewayUrl: GATEWAY_URL,
      graphqlUrl: GRAPHQL_URL,
      publisher: '0xowner',
      epoch: 1,
      leafUris,
    });

    if (firstKey === undefined) {
      throw new Error('expected leaf key');
    }

    const payload = await getLeaf(firstKey);
    expect(payload.leaf).toBeTruthy();
  });
});
