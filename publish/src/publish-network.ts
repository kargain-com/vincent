import type { Chain } from 'viem';
import { base, baseSepolia } from 'viem/chains';

import {
  BASE_MAINNET_CHAIN_ID,
  BASE_SEPOLIA_CHAIN_ID,
  DEFAULT_ANCHOR_ONLY_INDEX_CHECK_MAX_REUPLOADS,
  DEFAULT_ANCHOR_ONLY_INDEX_CHECK_TIMEOUT_MS,
  DEFAULT_ANCHOR_ONLY_POST_REUPLOAD_DELAY_MS,
  DEFAULT_FULL_INDEX_CHECK_CONCURRENCY,
  DEFAULT_FULL_INDEX_CHECK_DELAY_MS,
  DEFAULT_FULL_INDEX_CHECK_MAX_REUPLOADS,
  DEFAULT_FULL_INDEX_CHECK_TIMEOUT_MS,
  DEFAULT_MAINNET_FULL_INDEX_CHECK_DELAY_MS,
  DEFAULT_MAINNET_MAX_REUPLOAD_LEAVES,
  DEFAULT_MAINNET_POST_REUPLOAD_DELAY_MS,
  DEFAULT_POST_REUPLOAD_DELAY_MS,
  IRYS_GATEWAY_URL,
  IRYS_TESTNET_GATEWAY_URL,
} from './constants.js';

export type PublishNetworkId = 'base-sepolia' | 'base';

export interface PublishNetworkProfile {
  id: PublishNetworkId;
  chainId: number;
  chain: Chain;
  rpcEnvVar: string;
  defaultGatewayUrl: string;
  explorerTxUrl: string;
  indexCheck: {
    fullDelayMs: number;
    postReuploadDelayMs: number;
    reuploadOnFailureDefault: boolean;
    maxReuploadLeavesDefault: number | undefined;
  };
}

const NETWORK_PROFILES: Record<PublishNetworkId, PublishNetworkProfile> = {
  'base-sepolia': {
    id: 'base-sepolia',
    chainId: BASE_SEPOLIA_CHAIN_ID,
    chain: baseSepolia,
    rpcEnvVar: 'BASE_SEPOLIA_RPC_URL',
    defaultGatewayUrl: IRYS_TESTNET_GATEWAY_URL,
    explorerTxUrl: 'https://sepolia.basescan.org/tx/',
    indexCheck: {
      fullDelayMs: DEFAULT_FULL_INDEX_CHECK_DELAY_MS,
      postReuploadDelayMs: DEFAULT_POST_REUPLOAD_DELAY_MS,
      reuploadOnFailureDefault: true,
      maxReuploadLeavesDefault: undefined,
    },
  },
  base: {
    id: 'base',
    chainId: BASE_MAINNET_CHAIN_ID,
    chain: base,
    rpcEnvVar: 'BASE_MAINNET_RPC_URL',
    defaultGatewayUrl: IRYS_GATEWAY_URL,
    explorerTxUrl: 'https://basescan.org/tx/',
    indexCheck: {
      fullDelayMs: DEFAULT_MAINNET_FULL_INDEX_CHECK_DELAY_MS,
      postReuploadDelayMs: DEFAULT_MAINNET_POST_REUPLOAD_DELAY_MS,
      reuploadOnFailureDefault: false,
      maxReuploadLeavesDefault: 0,
    },
  },
};

export function resolvePublishNetwork(id: PublishNetworkId): PublishNetworkProfile {
  return NETWORK_PROFILES[id];
}

export function resolveIrysGatewayUrl(
  chainId: number,
  envOverride?: string,
): string {
  if (envOverride !== undefined && envOverride.length > 0) {
    return envOverride;
  }
  if (chainId === BASE_SEPOLIA_CHAIN_ID) {
    return IRYS_TESTNET_GATEWAY_URL;
  }
  if (chainId === BASE_MAINNET_CHAIN_ID) {
    return IRYS_GATEWAY_URL;
  }
  throw new Error(`Unsupported chain for Irys gateway: ${chainId}`);
}

export interface IndexCheckCliOverrides {
  indexCheckConcurrency?: number;
  indexCheckDelayMs?: number;
  indexCheckTimeoutMs?: number;
  allowReupload?: boolean;
  maxReuploadLeaves?: number;
}

export interface ResolvedIndexCheckDefaults {
  timeoutMs: number | undefined;
  delayMs: number | undefined;
  concurrency: number | undefined;
  maxReuploadAttempts: number;
  postReuploadDelayMs: number;
  reuploadOnFailure: boolean;
  maxReuploadLeaves: number | undefined;
}

export function resolveIndexCheckDefaults(
  profile: PublishNetworkProfile,
  fixture: 'genesis-mini' | 'full',
  anchorOnly: boolean,
  cli: IndexCheckCliOverrides,
): ResolvedIndexCheckDefaults {
  const isFull = fixture === 'full';
  const allowReupload =
    cli.allowReupload ?? profile.indexCheck.reuploadOnFailureDefault;

  let maxReuploadLeaves: number | undefined;
  if (cli.maxReuploadLeaves !== undefined) {
    maxReuploadLeaves = cli.maxReuploadLeaves;
  } else if (!allowReupload) {
    maxReuploadLeaves = 0;
  } else if (profile.id === 'base' && isFull) {
    maxReuploadLeaves = DEFAULT_MAINNET_MAX_REUPLOAD_LEAVES;
  } else {
    maxReuploadLeaves = undefined;
  }

  return {
    timeoutMs:
      cli.indexCheckTimeoutMs ??
      (anchorOnly
        ? DEFAULT_ANCHOR_ONLY_INDEX_CHECK_TIMEOUT_MS
        : isFull
          ? DEFAULT_FULL_INDEX_CHECK_TIMEOUT_MS
          : undefined),
    delayMs:
      cli.indexCheckDelayMs ??
      (anchorOnly ? 0 : isFull ? profile.indexCheck.fullDelayMs : undefined),
    concurrency:
      cli.indexCheckConcurrency ??
      (isFull ? DEFAULT_FULL_INDEX_CHECK_CONCURRENCY : undefined),
    maxReuploadAttempts: anchorOnly
      ? DEFAULT_ANCHOR_ONLY_INDEX_CHECK_MAX_REUPLOADS
      : DEFAULT_FULL_INDEX_CHECK_MAX_REUPLOADS,
    postReuploadDelayMs: anchorOnly
      ? DEFAULT_ANCHOR_ONLY_POST_REUPLOAD_DELAY_MS
      : profile.indexCheck.postReuploadDelayMs,
    reuploadOnFailure: allowReupload,
    maxReuploadLeaves,
  };
}
