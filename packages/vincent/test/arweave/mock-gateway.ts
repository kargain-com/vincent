import type { MerkleProof } from '@kargain/vincent/decoder';

export interface MockGatewayItem {
  owner: string;
  epoch: number;
  leafKey: string;
  txId: string;
  height: number;
  data: { leaf: string; proof: MerkleProof };
}

export function requestUrl(input: RequestInfo | URL): string {
  if (typeof input === 'string') {
    return input;
  }
  if (input instanceof URL) {
    return input.href;
  }
  return input.url;
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

export function createMockGateway(items: MockGatewayItem[]): {
  gatewayUrl: string;
  fetchImpl: typeof fetch;
} {
  const gatewayUrl = 'https://mock.arweave.test';
  const byTxId = new Map(items.map((item) => [item.txId, item]));

  const fetchImpl: typeof fetch = (input, init) => {
    const url = requestUrl(input);
    const body = typeof init?.body === 'string' ? init.body : '';

    if (url === `${gatewayUrl}/graphql` && init?.method === 'POST') {
      const parsed = JSON.parse(body) as { query?: string };
      const query = parsed.query ?? '';
      const owner = extractOwner(query);
      const epoch = extractEpoch(query);
      const leafKey = extractLeafKey(query);

      const matches =
        owner === null || epoch === null || leafKey === null
          ? []
          : items
              .filter(
                (item) =>
                  item.owner === owner && item.epoch === epoch && item.leafKey === leafKey,
              )
              .sort((a, b) => b.height - a.height);

      const edges = matches.slice(0, 1).map((item) => ({ node: { id: item.txId } }));
      return Promise.resolve(
        new Response(JSON.stringify({ data: { transactions: { edges } } }), {
          status: 200,
          headers: { 'content-type': 'application/json' },
        }),
      );
    }

    const txId = url.slice(`${gatewayUrl}/`.length);
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

  return { gatewayUrl, fetchImpl };
}
