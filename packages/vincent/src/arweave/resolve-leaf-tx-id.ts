import {
  buildLeafKeyTransactionQuery,
  executeGraphqlWithOrderFallback,
  normalizeGraphqlUrl,
} from './irys-graphql.js';

export interface ResolveLeafTxIdOptions {
  graphqlUrl: string;
  publisher: string;
  epoch: number;
  leafKey: string;
  fetchImpl?: typeof fetch;
}

/** One-shot GraphQL lookup for the newest tx id tagged with LeafKey (no polling). */
export async function resolveLeafTxId(options: ResolveLeafTxIdOptions): Promise<string | null> {
  const fetchImpl = options.fetchImpl ?? fetch;
  const graphqlUrl = normalizeGraphqlUrl(options.graphqlUrl);

  const payload = await executeGraphqlWithOrderFallback(fetchImpl, graphqlUrl, (orderArgument) =>
    buildLeafKeyTransactionQuery({
      publisher: options.publisher,
      epoch: options.epoch,
      leafKey: options.leafKey,
      orderArgument,
    }),
  );

  if (payload.errors !== undefined && payload.errors.length > 0) {
    const message = payload.errors.map((error) => error.message).join('; ');
    throw new Error(`graphql query failed: ${message}`);
  }

  const id = payload.data?.transactions?.edges?.[0]?.node?.id;
  return typeof id === 'string' && id.length > 0 ? id : null;
}

export function leafTxIdToUri(txId: string): string {
  return txId.startsWith('ar://') ? txId : `ar://${txId}`;
}
