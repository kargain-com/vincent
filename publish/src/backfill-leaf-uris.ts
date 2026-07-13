interface GraphqlTag {
  name: string;
  value: string;
}

interface GraphqlLeafPage {
  pageInfo: {
    hasNextPage: boolean;
    endCursor: string | null;
  };
  edges: Array<{
    cursor: string;
    node: {
      id: string;
      tags: GraphqlTag[];
    };
  }>;
}

interface GraphqlResponse {
  errors?: Array<{ message: string }>;
  data?: {
    transactions?: GraphqlLeafPage;
  };
}

export interface BackfillLeafUrisOptions {
  graphqlUrl: string;
  publisher: string;
  epochNumber: number;
  fetchImpl?: typeof fetch;
  pageSize?: number;
  onProgress?: (progress: BackfillLeafUrisProgress) => void;
}

export interface BackfillLeafUrisProgress {
  pagesFetched: number;
  transactionsScanned: number;
  leafUrisDiscovered: number;
}

export interface BackfillLeafUrisResult {
  leafUris: Record<string, string>;
  pagesFetched: number;
  transactionsScanned: number;
}

function normalizeUrl(url: string): string {
  return url.replace(/\/+$/, '');
}

function buildEpochLeavesQuery(
  publisher: string,
  epochNumber: number,
  pageSize: number,
  after: string | null,
  orderArgument: 'sort: HEIGHT_DESC' | 'order: DESC',
): string {
  const owners = JSON.stringify([publisher.toLowerCase()]);
  const epochValue = JSON.stringify(String(epochNumber));
  const afterArg = after === null ? '' : `, after: ${JSON.stringify(after)}`;
  return `query {
  transactions(
    owners: ${owners}
    tags: [
      { name: "App", values: ["vincent"] }
      { name: "Epoch", values: [${epochValue}] }
    ]
    ${orderArgument}
    first: ${String(pageSize)}
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

function leafKeyFromTags(tags: GraphqlTag[]): string | null {
  const leafKey = tags.find((tag) => tag.name === 'LeafKey')?.value;
  return typeof leafKey === 'string' && leafKey.length > 0 ? leafKey : null;
}

function mergeLeafUri(
  leafUris: Record<string, string>,
  leafKey: string,
  txId: string,
): void {
  const uri = `ar://${txId}`;
  if (leafUris[leafKey] === undefined) {
    leafUris[leafKey] = uri;
  }
}

/**
 * Paginate owner+epoch GraphQL (without per-LeafKey filter) and build leafKey → ar://txId.
 * Newest tx wins when duplicates appear (DESC order; first seen per key is kept).
 */
export async function backfillLeafUrisFromGraphql(
  options: BackfillLeafUrisOptions,
): Promise<BackfillLeafUrisResult> {
  const fetchImpl = options.fetchImpl ?? fetch;
  const graphqlUrl = normalizeUrl(options.graphqlUrl);
  const pageSize = options.pageSize ?? 100;
  const leafUris: Record<string, string> = {};
  let pagesFetched = 0;
  let transactionsScanned = 0;
  let after: string | null = null;
  let orderArgument: 'sort: HEIGHT_DESC' | 'order: DESC' = 'order: DESC';

  while (true) {
    let payload = await executeGraphql(
      fetchImpl,
      graphqlUrl,
      buildEpochLeavesQuery(
        options.publisher,
        options.epochNumber,
        pageSize,
        after,
        orderArgument,
      ),
    );

    if (orderArgumentUnsupported(payload)) {
      orderArgument = 'sort: HEIGHT_DESC';
      payload = await executeGraphql(
        fetchImpl,
        graphqlUrl,
        buildEpochLeavesQuery(
          options.publisher,
          options.epochNumber,
          pageSize,
          after,
          orderArgument,
        ),
      );
    }

    if (payload.errors !== undefined && payload.errors.length > 0) {
      throw new Error(payload.errors.map((e) => e.message).join('; '));
    }

    const page = payload.data?.transactions;
    if (page === undefined) {
      throw new Error('graphql response missing transactions');
    }

    pagesFetched += 1;
    for (const edge of page.edges) {
      transactionsScanned += 1;
      const leafKey = leafKeyFromTags(edge.node.tags);
      if (leafKey === null) continue;
      mergeLeafUri(leafUris, leafKey, edge.node.id);
    }

    options.onProgress?.({
      pagesFetched,
      transactionsScanned,
      leafUrisDiscovered: Object.keys(leafUris).length,
    });

    if (!page.pageInfo.hasNextPage || page.pageInfo.endCursor === null) {
      break;
    }
    after = page.pageInfo.endCursor;
  }

  return { leafUris, pagesFetched, transactionsScanned };
}
