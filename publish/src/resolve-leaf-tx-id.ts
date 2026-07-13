interface GraphqlResponse {
  errors?: Array<{ message: string }>;
  data?: {
    transactions?: {
      edges?: Array<{ node?: { id?: string } }>;
    };
  };
}

export interface ResolveLeafTxIdOptions {
  graphqlUrl: string;
  publisher: string;
  epochNumber: number;
  leafKey: string;
  fetchImpl?: typeof fetch;
}

function normalizeUrl(url: string): string {
  return url.replace(/\/+$/, '');
}

function buildLeafQuery(
  publisher: string,
  epochNumber: number,
  leafKey: string,
  orderArgument: 'sort: HEIGHT_DESC' | 'order: DESC',
): string {
  const owners = JSON.stringify([publisher.toLowerCase()]);
  const epochValue = JSON.stringify(String(epochNumber));
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

function sortArgumentUnsupported(payload: GraphqlResponse): boolean {
  return payload.errors?.some((e) => e.message?.includes('Unknown argument "sort"')) === true;
}

function orderArgumentUnsupported(payload: GraphqlResponse): boolean {
  return payload.errors?.some((e) => e.message?.includes('Unknown argument "order"')) === true;
}

async function executeGraphql(
  fetchImpl: typeof fetch,
  graphqlUrl: string,
  query: string,
): Promise<GraphqlResponse> {
  const response = await fetchImpl(graphqlUrl, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ query }),
  });
  const body = (await response.json()) as GraphqlResponse;
  if (!response.ok && !sortArgumentUnsupported(body) && !orderArgumentUnsupported(body)) {
    throw new Error(`graphql request failed: ${response.status}`);
  }
  return body;
}

/** One-shot GraphQL lookup for the newest tx id tagged with LeafKey (no polling). */
export async function resolveLeafTxId(options: ResolveLeafTxIdOptions): Promise<string | null> {
  const fetchImpl = options.fetchImpl ?? fetch;
  const graphqlUrl = normalizeUrl(options.graphqlUrl);
  const publisher = options.publisher.toLowerCase();

  let payload = await executeGraphql(
    fetchImpl,
    graphqlUrl,
    buildLeafQuery(publisher, options.epochNumber, options.leafKey, 'order: DESC'),
  );
  if (orderArgumentUnsupported(payload)) {
    payload = await executeGraphql(
      fetchImpl,
      graphqlUrl,
      buildLeafQuery(publisher, options.epochNumber, options.leafKey, 'sort: HEIGHT_DESC'),
    );
  }
  if (payload.errors !== undefined && payload.errors.length > 0) {
    throw new Error(payload.errors.map((e) => e.message).join('; '));
  }
  const id = payload.data?.transactions?.edges?.[0]?.node?.id;
  return typeof id === 'string' && id.length > 0 ? id : null;
}

export function leafTxIdToUri(txId: string): string {
  return txId.startsWith('ar://') ? txId : `ar://${txId}`;
}
