import type { GetLeaf } from '../decoder/leaf-types.js';

import {
  createArweaveGetLeaf,
  type ArweaveGetLeafOptions,
} from './create-arweave-get-leaf.js';
import { fetchLeafFromGateway } from './fetch-leaf-from-gateway.js';

export interface ArweaveGetLeafWithUrisOptions extends ArweaveGetLeafOptions {
  /** leafKey → ar://txId; tried before GraphQL tag query. */
  leafUris?: Record<string, string>;
}

function normalizeGatewayUrl(gatewayUrl: string): string {
  return gatewayUrl.replace(/\/+$/, '');
}

/**
 * Gateway-first getLeaf: use known ar:// tx ids when provided, else GraphQL tag query.
 * Does not verify Merkle inclusion — caller must use createDecoder/verifyLeaf.
 */
export function createArweaveGetLeafWithUris(
  options: ArweaveGetLeafWithUrisOptions,
): GetLeaf {
  const gatewayUrl = normalizeGatewayUrl(options.gatewayUrl);
  const fetchImpl = options.fetchImpl ?? fetch;
  const graphqlGetLeaf = createArweaveGetLeaf(options);
  const uris = options.leafUris ?? {};

  return async (leafKey: string) => {
    const uri = uris[leafKey];
    if (uri !== undefined) {
      try {
        return await fetchLeafFromGateway(gatewayUrl, uri, fetchImpl);
      } catch {
        // Fall back to GraphQL tag query.
      }
    }
    return graphqlGetLeaf(leafKey);
  };
}
