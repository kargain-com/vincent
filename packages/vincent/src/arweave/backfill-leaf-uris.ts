import {
  buildEpochTransactionQuery,
  executeGraphqlQuery,
  normalizeGraphqlUrl,
  orderArgumentUnsupported,
  type GraphqlTag,
  type GraphqlTransactionPage,
} from './irys-graphql.js';
import { leafTxIdToUri } from './resolve-leaf-tx-id.js';

export interface BackfillLeafUrisOptions {
  graphqlUrl: string;
  publisher: string;
  epoch: number;
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

function leafKeyFromTags(tags: GraphqlTag[]): string | null {
  const leafKey = tags.find((tag) => tag.name === 'LeafKey')?.value;
  return typeof leafKey === 'string' && leafKey.length > 0 ? leafKey : null;
}

function mergeLeafUri(leafUris: Record<string, string>, leafKey: string, txId: string): void {
  const uri = leafTxIdToUri(txId);
  if (leafUris[leafKey] === undefined) {
    leafUris[leafKey] = uri;
  }
}

function isTransactionPage(
  transactions: GraphqlTransactionPage | { edges?: Array<{ node?: { id?: string } }> },
): transactions is GraphqlTransactionPage {
  return 'pageInfo' in transactions;
}

/**
 * Paginate owner+epoch GraphQL (without per-LeafKey filter) and build leafKey → ar://txId.
 * Newest tx wins when duplicates appear (DESC order; first seen per key is kept).
 */
export async function backfillLeafUrisFromGraphql(
  options: BackfillLeafUrisOptions,
): Promise<BackfillLeafUrisResult> {
  const fetchImpl = options.fetchImpl ?? fetch;
  const graphqlUrl = normalizeGraphqlUrl(options.graphqlUrl);
  const pageSize = options.pageSize ?? 100;
  const leafUris: Record<string, string> = {};
  let pagesFetched = 0;
  let transactionsScanned = 0;
  let after: string | null = null;
  let orderArgument: 'sort: HEIGHT_DESC' | 'order: DESC' = 'order: DESC';

  while (true) {
    let payload = await executeGraphqlQuery(
      fetchImpl,
      graphqlUrl,
      buildEpochTransactionQuery({
        publisher: options.publisher,
        epoch: options.epoch,
        pageSize,
        after,
        orderArgument,
      }),
    );

    if (orderArgumentUnsupported(payload)) {
      orderArgument = 'sort: HEIGHT_DESC';
      payload = await executeGraphqlQuery(
        fetchImpl,
        graphqlUrl,
        buildEpochTransactionQuery({
          publisher: options.publisher,
          epoch: options.epoch,
          pageSize,
          after,
          orderArgument,
        }),
      );
    }

    if (payload.errors !== undefined && payload.errors.length > 0) {
      const message = payload.errors.map((error) => error.message).join('; ');
      throw new Error(`graphql query failed: ${message}`);
    }

    const transactions = payload.data?.transactions;
    if (transactions === undefined || !isTransactionPage(transactions)) {
      throw new Error('graphql response missing transactions');
    }

    pagesFetched += 1;
    for (const edge of transactions.edges) {
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

    if (!transactions.pageInfo.hasNextPage || transactions.pageInfo.endCursor === null) {
      break;
    }
    after = transactions.pageInfo.endCursor;
  }

  return { leafUris, pagesFetched, transactionsScanned };
}
