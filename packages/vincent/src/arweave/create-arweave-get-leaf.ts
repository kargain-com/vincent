import type { GetLeaf } from '../decoder/leaf-types.js';

import { LeafNotFoundError } from './errors.js';
import { fetchLeafFromGateway } from './fetch-leaf-from-gateway.js';
import { normalizeGraphqlUrl } from './irys-graphql.js';
import { resolveLeafTxId } from './resolve-leaf-tx-id.js';

export interface ArweaveGetLeafOptions {
  gatewayUrl: string;
  /** GraphQL endpoint when it is not hosted at `${gatewayUrl}/graphql` (for example Irys). */
  graphqlUrl?: string;
  publisher: string;
  epoch: number;
  fetchImpl?: typeof fetch;
}

function normalizeGatewayUrl(gatewayUrl: string): string {
  return gatewayUrl.replace(/\/+$/, '');
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
    const txId = await resolveLeafTxId({
      graphqlUrl,
      publisher,
      epoch,
      leafKey,
      fetchImpl,
    });
    if (txId === null) {
      throw new LeafNotFoundError(leafKey);
    }
    return fetchLeafFromGateway(gatewayUrl, txId, fetchImpl);
  };
}

export { LeafNotFoundError } from './errors.js';
