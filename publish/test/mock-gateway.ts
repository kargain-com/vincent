import type { MerkleProof } from '@kargain/vincent/decoder';

export interface MockGatewayItem {
  owner: string;
  epoch: number;
  leafKey: string;
  txId: string;
  height: number;
  data: { leaf: string; proof: MerkleProof };
}

function extractArtifactType(query: string): string | null {
  const match = query.match(/Type", values: \["([^"]+)"\]/);
  return match?.[1] ?? null;
}

export interface MockArtifactItem {
  owner: string;
  epoch: number;
  artifactType: string;
  txId: string;
  height: number;
}

export interface MockGatewayOptions {
  gatewayUrl?: string;
  graphqlUrl?: string;
  staticBodies?: Record<string, string>;
  staticBinaryBodies?: Record<string, Uint8Array>;
  artifactItems?: MockArtifactItem[];
}

function extractLeafKey(query: string): string | null {
  const match = query.match(/LeafKey", values: \["([^"]+)"\]/);
  return match?.[1] ?? null;
}

function extractOwner(query: string): string | null {
  const match = query.match(/owners: \["([^"]+)"\]/);
  return match?.[1] ?? null;
}

function extractEpoch(query: string): number | null {
  const match = query.match(/Epoch", values: \["(\d+)"\]/);
  if (match?.[1] === undefined) {
    return null;
  }
  return Number.parseInt(match[1], 10);
}

function usesHeightDescSort(query: string): boolean {
  return query.includes('sort: HEIGHT_DESC');
}

function usesOrderDesc(query: string): boolean {
  return query.includes('order: DESC');
}

export function createMockGateway(
  items: MockGatewayItem[],
  options?: MockGatewayOptions,
): {
  gatewayUrl: string;
  graphqlUrl: string;
  fetchImpl: typeof fetch;
} {
  const gatewayUrl = options?.gatewayUrl ?? 'https://mock.arweave.test';
  const graphqlUrl = options?.graphqlUrl ?? `${gatewayUrl}/graphql`;
  const staticBodies = options?.staticBodies ?? {};
  const staticBinaryBodies = options?.staticBinaryBodies ?? {};
  const artifactItems = options?.artifactItems ?? [];
  const byTxId = new Map(items.map((item) => [item.txId, item]));

  const fetchImpl: typeof fetch = (input, init) => {
    const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;

    if (url === graphqlUrl && init?.method === 'POST') {
      const body = typeof init.body === 'string' ? init.body : '';
      const parsed = JSON.parse(body) as { query?: string };
      const query = parsed.query ?? '';
      const owner = extractOwner(query);
      const epoch = extractEpoch(query);
      const leafKey = extractLeafKey(query);
      const artifactType = extractArtifactType(query);

      if (usesHeightDescSort(query) && !usesOrderDesc(query)) {
        return Promise.resolve(
          new Response(
            JSON.stringify({
              errors: [{ message: 'Unknown argument "sort" on field "Query.transactions".' }],
            }),
            { status: 400, headers: { 'content-type': 'application/json' } },
          ),
        );
      }

      const matches =
        owner === null || epoch === null
          ? []
          : leafKey !== null
            ? items
                .filter(
                  (item) =>
                    item.owner.toLowerCase() === owner.toLowerCase() &&
                    item.epoch === epoch &&
                    item.leafKey === leafKey,
                )
                .sort((a, b) => b.height - a.height)
            : artifactType !== null
              ? artifactItems
                  .filter(
                    (item) =>
                      item.owner.toLowerCase() === owner.toLowerCase() &&
                      item.epoch === epoch &&
                      item.artifactType === artifactType,
                  )
                  .sort((a, b) => b.height - a.height)
              : [];

      const edges = matches.slice(0, 1).map((item) => ({ node: { id: item.txId } }));
      return Promise.resolve(
        new Response(JSON.stringify({ data: { transactions: { edges } } }), {
          status: 200,
          headers: { 'content-type': 'application/json' },
        }),
      );
    }

    const txId = url.slice(`${gatewayUrl.replace(/\/+$/, '')}/`.length);
    const binaryBody = staticBinaryBodies[txId];
    if (binaryBody !== undefined) {
      return Promise.resolve(
        new Response(binaryBody, {
          status: 200,
          headers: { 'content-type': 'application/octet-stream' },
        }),
      );
    }
    const staticBody = staticBodies[txId];
    if (staticBody !== undefined) {
      return Promise.resolve(
        new Response(staticBody, {
          status: 200,
          headers: { 'content-type': 'application/json' },
        }),
      );
    }

    const item = byTxId.get(txId);
    if (item === undefined) {
      return Promise.resolve(new Response('not found', { status: 404 }));
    }

    return Promise.resolve(
      new Response(JSON.stringify(item.data), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      }),
    );
  };

  return { gatewayUrl, graphqlUrl, fetchImpl };
}
