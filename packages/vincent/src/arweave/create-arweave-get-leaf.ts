import type { GetLeaf, MerkleProof } from '../decoder/leaf-types.js';

import { LeafNotFoundError } from './errors.js';

export interface ArweaveGetLeafOptions {
  gatewayUrl: string;
  /** GraphQL endpoint when it is not hosted at `${gatewayUrl}/graphql` (for example Irys). */
  graphqlUrl?: string;
  publisher: string;
  epoch: number;
  fetchImpl?: typeof fetch;
}

interface GraphqlResponse {
  errors?: Array<{ message: string }>;
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

function normalizeGraphqlUrl(graphqlUrl: string): string {
  return graphqlUrl.replace(/\/+$/, '');
}

function buildGraphqlQuery(
  publisher: string,
  epoch: number,
  leafKey: string,
  orderArgument: 'sort: HEIGHT_DESC' | 'order: DESC',
): string {
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
    ${orderArgument}
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

function sortArgumentUnsupported(payload: GraphqlResponse): boolean {
  return (
    payload.errors?.some((error) => error.message?.includes('Unknown argument "sort"')) === true
  );
}

function orderArgumentUnsupported(payload: GraphqlResponse): boolean {
  return (
    payload.errors?.some((error) => error.message?.includes('Unknown argument "order"')) ===
    true
  );
}

async function executeGraphqlQuery(
  fetchImpl: typeof fetch,
  graphqlUrl: string,
  publisher: string,
  epoch: number,
  leafKey: string,
  orderArgument: 'sort: HEIGHT_DESC' | 'order: DESC',
): Promise<GraphqlResponse> {
  const response = await fetchImpl(graphqlUrl, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      query: buildGraphqlQuery(publisher, epoch, leafKey, orderArgument),
    }),
  });

  let body: GraphqlResponse;
  try {
    body = (await response.json()) as GraphqlResponse;
  } catch {
    if (!response.ok) {
      throw new Error(`graphql request failed: ${response.status}`);
    }
    throw new Error('graphql response was not valid JSON');
  }

  if (!response.ok) {
    if (sortArgumentUnsupported(body) || orderArgumentUnsupported(body)) {
      return body;
    }
    throw new Error(`graphql request failed: ${response.status}`);
  }
  return body;
}

async function queryTransactionId(
  fetchImpl: typeof fetch,
  graphqlUrl: string,
  publisher: string,
  epoch: number,
  leafKey: string,
): Promise<string | null> {
  let payload = await executeGraphqlQuery(
    fetchImpl,
    graphqlUrl,
    publisher,
    epoch,
    leafKey,
    'order: DESC',
  );

  if (orderArgumentUnsupported(payload)) {
    payload = await executeGraphqlQuery(
      fetchImpl,
      graphqlUrl,
      publisher,
      epoch,
      leafKey,
      'sort: HEIGHT_DESC',
    );
  }

  if (payload.errors !== undefined && payload.errors.length > 0) {
    const message = payload.errors.map((error) => error.message).join('; ');
    throw new Error(`graphql query failed: ${message}`);
  }

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
  const graphqlUrl = normalizeGraphqlUrl(options.graphqlUrl ?? `${gatewayUrl}/graphql`);
  const fetchImpl = options.fetchImpl ?? fetch;
  const { publisher, epoch } = options;

  return async (leafKey: string) => {
    const txId = await queryTransactionId(fetchImpl, graphqlUrl, publisher, epoch, leafKey);
    if (txId === null) {
      throw new LeafNotFoundError(leafKey);
    }
    return fetchLeafData(fetchImpl, gatewayUrl, txId);
  };
}

export { LeafNotFoundError } from './errors.js';
