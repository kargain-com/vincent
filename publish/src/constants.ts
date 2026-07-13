/** sha256:<64 lowercase hex> */
const SHA256_HASH_RE = /^sha256:[0-9a-f]{64}$/;

/** Genesis parentRoot sentinel (matches on-chain bytes32 zero). */
export const ZERO_MERKLE_ROOT = `sha256:${'0'.repeat(64)}`;

/** Hardhat account #0 — test/fixture only. */
export const TEST_PRIVATE_KEY =
  '0xac0974bec39a17e36ba4a6b4d238ff944bacb478cab039431e99c5825582831';

export const TEST_PUBLISHER = '0xa0e58EC0f3dF4f127e9203A7fd6a494c483719B3';

export const DEFAULT_GENESIS_REVIEW_POLICY = {
  minAccepts: 1,
  reviewers: [TEST_PUBLISHER],
} as const;

export function isSha256Hash(value: string): boolean {
  return SHA256_HASH_RE.test(value);
}

export function isZeroParentRoot(parentRoot: string | null): boolean {
  return parentRoot === null || parentRoot === ZERO_MERKLE_ROOT;
}

/** VincentAnchorRegistry on Base Sepolia. */
export const REGISTRY_ADDRESS = '0x06667DB3795C70F34b7517D1Af1217D3167BE241' as const;

export const BASE_SEPOLIA_CHAIN_ID = 84532;

/** Base mainnet chain ID (Kargain-aligned). */
export const BASE_MAINNET_CHAIN_ID = 8453;

/** Irys devnet bundler for Base Sepolia testnet uploads. */
export const IRYS_DEVNET_BUNDLER_URL = 'https://devnet.irys.xyz';

/** Irys mainnet bundler for Base mainnet uploads (Kargain: node2.irys.xyz). */
export const IRYS_MAINNET_BUNDLER_URL = 'https://node2.irys.xyz';

/** Chains that use {@link IRYS_MAINNET_BUNDLER_URL} (matches Kargain irysNodeUrl). */
export const IRYS_MAINNET_CHAIN_IDS = [1, BASE_MAINNET_CHAIN_ID] as const;

/** Irys fund() gas multiplier for congested testnets (matches Kargain). */
export const IRYS_FUND_FEE_MULTIPLIER = 1.2;

/** Per-request Irys bundler timeout (matches Kargain web uploader). */
export const IRYS_UPLOAD_TIMEOUT_MS = 120_000;

/** Retries for transient Irys upload failures (ETIMEDOUT, 5xx, etc.). */
export const IRYS_UPLOAD_MAX_ATTEMPTS = 5;

/** Irys data retrieval and ANS-104 tag-query endpoints. */
export const IRYS_GATEWAY_URL = 'https://gateway.irys.xyz';
export const IRYS_TESTNET_GATEWAY_URL = 'https://testnet-gateway.irys.xyz';
export const IRYS_GRAPHQL_URL = 'https://uploader.irys.xyz/graphql';

/** Default parallel leaf uploads for full seed publishes. */
export const DEFAULT_FULL_UPLOAD_CONCURRENCY = 10;

/** Pause before GraphQL index verification (bundler catch-up). */
export const DEFAULT_FULL_INDEX_CHECK_DELAY_MS = 180_000;

/** Parallel GraphQL leaf verifications for full seed publishes. */
export const DEFAULT_FULL_INDEX_CHECK_CONCURRENCY = 20;

/** Per-leaf GraphQL index timeout for full seed publishes. */
export const DEFAULT_FULL_INDEX_CHECK_TIMEOUT_MS = 120_000;

/** Per-leaf GraphQL poll budget for --anchor-only (gateway-first; poll is last resort). */
export const DEFAULT_ANCHOR_ONLY_INDEX_CHECK_TIMEOUT_MS = 5_000;

/** Index-check log interval for full seed (leaves phase uses 250). */
export const DEFAULT_FULL_INDEX_CHECK_LOG_INTERVAL = 25;

/** Re-upload attempts when gateway-first verification still misses a leaf. */
export const DEFAULT_FULL_INDEX_CHECK_MAX_REUPLOADS = 2;

/** Re-upload attempts for --anchor-only (gateway-first; same as full). */
export const DEFAULT_ANCHOR_ONLY_INDEX_CHECK_MAX_REUPLOADS = 2;

/** Pause after re-upload before polling GraphQL again (bundler catch-up). */
export const DEFAULT_POST_REUPLOAD_DELAY_MS = 60_000;

/** Post-re-upload pause for --anchor-only (gateway verifies immediately after re-upload). */
export const DEFAULT_ANCHOR_ONLY_POST_REUPLOAD_DELAY_MS = 0;

// Bundler URL policy aligned with Kargain lib/storage/irys-client.ts (irysNodeUrl).

export function isBaseMainnetChainId(chainId: number): boolean {
  return chainId === BASE_MAINNET_CHAIN_ID;
}

export function isIrysMainnetChain(chainId: number): boolean {
  return (IRYS_MAINNET_CHAIN_IDS as readonly number[]).includes(chainId);
}

/** Resolve Irys bundler URL for supported Base chains (8453 / 84532). */
export function resolveIrysBundlerUrl(chainId: number): string {
  if (isIrysMainnetChain(chainId)) return IRYS_MAINNET_BUNDLER_URL;
  if (chainId === BASE_SEPOLIA_CHAIN_ID) return IRYS_DEVNET_BUNDLER_URL;
  throw new Error(`Unsupported chain for Irys bundler: ${chainId}`);
}
