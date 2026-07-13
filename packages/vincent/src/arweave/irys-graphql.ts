export type GraphqlOrderArgument = 'sort: HEIGHT_DESC' | 'order: DESC';

export interface GraphqlTag {
  name: string;
  value: string;
}

export interface GraphqlTransactionEdge {
  cursor: string;
  node: {
    id: string;
    tags: GraphqlTag[];
  };
}

export interface GraphqlTransactionPage {
  pageInfo: {
    hasNextPage: boolean;
    endCursor: string | null;
  };
  edges: GraphqlTransactionEdge[];
}

export interface GraphqlTransactionsResponse {
  errors?: Array<{ message: string }>;
  data?: {
    transactions?: GraphqlTransactionPage | {
      edges?: Array<{ node?: { id?: string } }>;
    };
  };
}

export function normalizeGraphqlUrl(url: string): string {
  return url.replace(/\/+$/, '');
}

export function normalizePublisherAddress(publisher: string): string {
  return publisher.toLowerCase();
}

export function buildLeafKeyTransactionQuery(options: {
  publisher: string;
  epoch: number;
  leafKey: string;
  orderArgument: GraphqlOrderArgument;
  first?: number;
}): string {
  const owners = JSON.stringify([normalizePublisherAddress(options.publisher)]);
  const epochValue = JSON.stringify(String(options.epoch));
  const leafKeyValue = JSON.stringify(options.leafKey);
  const first = options.first ?? 1;
  return `query {
  transactions(
    owners: ${owners}
    tags: [
      { name: "App", values: ["vincent"] }
      { name: "Epoch", values: [${epochValue}] }
      { name: "LeafKey", values: [${leafKeyValue}] }
    ]
    ${options.orderArgument}
    first: ${String(first)}
  ) {
    edges {
      node {
        id
      }
    }
  }
}`;
}

export function buildEpochTransactionQuery(options: {
  publisher: string;
  epoch: number;
  pageSize: number;
  after: string | null;
  orderArgument: GraphqlOrderArgument;
}): string {
  const owners = JSON.stringify([normalizePublisherAddress(options.publisher)]);
  const epochValue = JSON.stringify(String(options.epoch));
  const afterArg = options.after === null ? '' : `, after: ${JSON.stringify(options.after)}`;
  return `query {
  transactions(
    owners: ${owners}
    tags: [
      { name: "App", values: ["vincent"] }
      { name: "Epoch", values: [${epochValue}] }
    ]
    ${options.orderArgument}
    first: ${String(options.pageSize)}
    ${afterArg}
  ) {
    pageInfo {
      hasNextPage
      endCursor
    }
    edges {
      cursor
      node {
        id
        tags {
          name
          value
        }
      }
    }
  }
}`;
}

export function buildLeafUriSidecarTransactionQuery(options: {
  publisher: string;
  epoch: number;
  orderArgument: GraphqlOrderArgument;
  first?: number;
}): string {
  const owners = JSON.stringify([normalizePublisherAddress(options.publisher)]);
  const epochValue = JSON.stringify(String(options.epoch));
  const first = options.first ?? 1;
  return `query {
  transactions(
    owners: ${owners}
    tags: [
      { name: "App", values: ["vincent"] }
      { name: "Epoch", values: [${epochValue}] }
      { name: "Kind", values: ["leaf-uris"] }
    ]
    ${options.orderArgument}
    first: ${String(first)}
  ) {
    edges {
      node {
        id
      }
    }
  }
}`;
}

export function sortArgumentUnsupported(payload: GraphqlTransactionsResponse): boolean {
  return payload.errors?.some((error) => error.message?.includes('Unknown argument "sort"')) === true;
}

export function orderArgumentUnsupported(payload: GraphqlTransactionsResponse): boolean {
  return payload.errors?.some((error) => error.message?.includes('Unknown argument "order"')) === true;
}

export async function executeGraphqlQuery(
  fetchImpl: typeof fetch,
  graphqlUrl: string,
  query: string,
): Promise<GraphqlTransactionsResponse> {
  const response = await fetchImpl(graphqlUrl, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ query }),
  });

  let body: GraphqlTransactionsResponse;
  try {
    body = (await response.json()) as GraphqlTransactionsResponse;
  } catch {
    if (!response.ok) {
      throw new Error(`graphql request failed: ${response.status}`);
    }
    throw new Error('graphql response was not valid JSON');
  }

  if (!response.ok && !sortArgumentUnsupported(body) && !orderArgumentUnsupported(body)) {
    throw new Error(`graphql request failed: ${response.status}`);
  }

  return body;
}

export async function executeGraphqlWithOrderFallback(
  fetchImpl: typeof fetch,
  graphqlUrl: string,
  buildQuery: (orderArgument: GraphqlOrderArgument) => string,
): Promise<GraphqlTransactionsResponse> {
  let payload = await executeGraphqlQuery(fetchImpl, graphqlUrl, buildQuery('order: DESC'));
  if (orderArgumentUnsupported(payload)) {
    payload = await executeGraphqlQuery(fetchImpl, graphqlUrl, buildQuery('sort: HEIGHT_DESC'));
  }
  return payload;
}
