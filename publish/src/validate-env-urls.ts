const IRYS_GATEWAY_HOST_RE =
  /(?:^|\.)gateway\.irys\.xyz$|(?:^|\.)testnet-gateway\.irys\.xyz$/i;

function parseUrl(url: string, envName: string): URL {
  try {
    return new URL(url);
  } catch {
    throw new Error(`${envName} must be a valid URL, got ${url}`);
  }
}

function isIrysGatewayHost(hostname: string): boolean {
  return IRYS_GATEWAY_HOST_RE.test(hostname);
}

/** Reject Irys gateway/data URLs where a JSON-RPC endpoint is required. */
export function assertJsonRpcUrl(url: string, envName: string): void {
  const parsed = parseUrl(url, envName);
  if (isIrysGatewayHost(parsed.hostname)) {
    throw new Error(
      `${envName} must be a JSON-RPC endpoint, not an Irys gateway URL (${url}). ` +
        'For Irys devnet uploads use Base Sepolia JSON-RPC (same as BASE_SEPOLIA_RPC_URL). ' +
        'Gateway/query URLs belong in IRYS_GATEWAY_URL and IRYS_GRAPHQL_URL.',
    );
  }
}

export function assertBaseSepoliaRpcUrl(url: string, envName: string): void {
  assertJsonRpcUrl(url, envName);
}

const DEPRECATED_IRYS_GRAPHQL_HOSTS = new Set([
  'arweave.devnet.irys.xyz',
  'arweave.mainnet.irys.xyz',
]);

/** Reject GraphQL endpoints that do not index Irys devnet uploads. */
export function assertIrysGraphqlUrl(url: string, envName: string): void {
  const hostname = parseUrl(url, envName).hostname;
  if (DEPRECATED_IRYS_GRAPHQL_HOSTS.has(hostname)) {
    throw new Error(
      `${envName} points to ${url}, which does not index Irys devnet uploads. ` +
        'Use https://uploader.irys.xyz/graphql (see https://docs.irys.xyz/onchain-storage/querying).',
    );
  }
}
