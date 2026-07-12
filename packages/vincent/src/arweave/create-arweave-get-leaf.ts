import type { GetLeaf, MerkleProof } from '../decoder/leaf-types.js';

import { LeafNotFoundError } from './errors.js';

export interface ArweaveGetLeafOptions {
  gatewayUrl: string;
  publisher: string;
  epoch: number;
  fetchImpl?: typeof fetch;
}

interface GraphqlResponse {
  data?: {
    transactions?: {
      edges?: Array<{ node?: { id?: string } }>;
    };
  };
}

interface LeafPayload {
  leaf: string | Uint8Array;
  proof: MerkleProof;
}

function normalizeGatewayUrl(gatewayUrl: string): string {
  return gatewayUrl.replace(/\/+$/, '');
}

function buildGraphqlQuery(publisher: string, epoch: number, leafKey: string): string {
  const owners = JSON.stringify([publisher]);
  const epochValue = JSON.stringify(String(epoch));
  const leafKeyValue = JSON.stringify(leafKey);
  return `query {
  transactions(
    owners: ${owners}
    tags: [
      { name: "App", values: ["vincent"] }
      { name: "Epoch", values: [${epochValue}] }
      { name: "LeafKey", values: [${leafKeyValue}] }
    ]
    sort: HEIGHT_DESC
    first: 1
  ) {
    edges {
      node {
        id
      }
    }
  }
}`;
}

function parseLeafPayload(body: string): LeafPayload {
  const parsed: unknown = JSON.parse(body);
  if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
    throw new Error('leaf data must be a JSON object');
  }
  const record = parsed as Record<string, unknown>;
  if (!('leaf' in record) || !('proof' in record)) {
    throw new Error('leaf data must contain leaf and proof');
  }
  const leaf = record.leaf;
  const proof = record.proof;
  if (typeof leaf !== 'string' && !(leaf instanceof Uint8Array)) {
    throw new Error('leaf must be a string or Uint8Array');
  }
  if (!Array.isArray(proof)) {
    throw new Error('proof must be an array');
  }
  return { leaf, proof: proof as MerkleProof };
}

async function queryTransactionId(
  fetchImpl: typeof fetch,
  gatewayUrl: string,
  publisher: string,
  epoch: number,
  leafKey: string,
): Promise<string | null> {
  const response = await fetchImpl(`${gatewayUrl}/graphql`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ query: buildGraphqlQuery(publisher, epoch, leafKey) }),
  });

  if (!response.ok) {
    throw new Error(`graphql request failed: ${response.status}`);
  }

  const payload = (await response.json()) as GraphqlResponse;
  const id = payload.data?.transactions?.edges?.[0]?.node?.id;
  return typeof id === 'string' && id.length > 0 ? id : null;
}

async function fetchLeafData(
  fetchImpl: typeof fetch,
  gatewayUrl: string,
  txId: string,
): Promise<LeafPayload> {
  const response = await fetchImpl(`${gatewayUrl}/${txId}`);
  if (!response.ok) {
    throw new Error(`leaf data fetch failed: ${response.status}`);
  }
  const body = await response.text();
  return parseLeafPayload(body);
}

/**
 * ANS-104 tag-query leaf provider for Arweave gateways.
 * Filters by owner + App/Epoch/LeafKey tags; returns newest match.
 * Does not verify Merkle inclusion — caller must use createDecoder/verifyLeaf.
 */
export function createArweaveGetLeaf(options: ArweaveGetLeafOptions): GetLeaf {
  const gatewayUrl = normalizeGatewayUrl(options.gatewayUrl);
  const fetchImpl = options.fetchImpl ?? fetch;
  const { publisher, epoch } = options;

  return async (leafKey: string) => {
    const txId = await queryTransactionId(fetchImpl, gatewayUrl, publisher, epoch, leafKey);
    if (txId === null) {
      throw new LeafNotFoundError(leafKey);
    }
    return fetchLeafData(fetchImpl, gatewayUrl, txId);
  };
}

export { LeafNotFoundError } from './errors.js';
