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

/** Irys devnet bundler for Base Sepolia testnet uploads. */
export const IRYS_DEVNET_BUNDLER_URL = 'https://devnet.irys.xyz';

/** Irys fund() gas multiplier for congested testnets (matches Kargain). */
export const IRYS_FUND_FEE_MULTIPLIER = 1.2;

/** Irys data retrieval and ANS-104 tag-query endpoints. */
export const IRYS_GATEWAY_URL = 'https://gateway.irys.xyz';
export const IRYS_GRAPHQL_URL = 'https://uploader.irys.xyz/graphql';
