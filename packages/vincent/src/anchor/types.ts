import type { Chain, Hex, PublicClient } from 'viem';

/** Deterministic CREATE2 VincentAnchorRegistry address (same on every EVM chain). */
export const DEFAULT_REGISTRY_ADDRESS =
  '0x06667DB3795C70F34b7517D1Af1217D3167BE241' as const;

/** Protocol-ready epoch record from on-chain VincentAnchorRegistry. */
export interface AnchorEpoch {
  epoch: number;
  merkleRoot: string;
  jsonlSha256: string;
  manifestHash: string;
  parentRoot: string | null;
  timestamp: number;
  manifestUri: string;
}

export interface AnchorReader {
  getEpochCount(publisher: Hex): Promise<number>;
  getEpoch(publisher: Hex, index: number): Promise<AnchorEpoch>;
  getLatestEpoch(publisher: Hex): Promise<AnchorEpoch>;
}

export interface CreateAnchorReaderOptions {
  rpcUrl?: string;
  registryAddress?: Hex;
  chain: Chain;
  publicClient?: PublicClient;
}

/** Raw epoch tuple returned by VincentAnchorRegistry view calls. */
export interface OnChainEpochTuple {
  merkleRoot: Hex;
  jsonlSha256: Hex;
  manifestHash: Hex;
  parentRoot: Hex;
  timestamp: bigint;
  manifestUri: string;
}
