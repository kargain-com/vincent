import { createPublicClient, http, type Hex } from 'viem';

import { bytes32ParentRoot, bytes32ToContentId } from './bytes32.js';
import { REGISTRY_ABI } from './registry-abi.js';
import {
  DEFAULT_REGISTRY_ADDRESS,
  type AnchorEpoch,
  type AnchorReader,
  type CreateAnchorReaderOptions,
  type OnChainEpochTuple,
} from './types.js';

function requireRpcUrl(rpcUrl: string | undefined): string {
  if (rpcUrl === undefined) {
    throw new Error('rpcUrl is required when no publicClient is provided');
  }
  return rpcUrl;
}

function mapOnChainEpoch(epochIndex: number, raw: OnChainEpochTuple): AnchorEpoch {
  return {
    epoch: epochIndex,
    merkleRoot: bytes32ToContentId(raw.merkleRoot),
    jsonlSha256: bytes32ToContentId(raw.jsonlSha256),
    manifestHash: bytes32ToContentId(raw.manifestHash),
    parentRoot: bytes32ParentRoot(raw.parentRoot),
    timestamp: Number(raw.timestamp),
    manifestUri: raw.manifestUri,
  };
}

/** Read VincentAnchorRegistry epochs via JSON-RPC (viem optional peer). */
export function createAnchorReader(options: CreateAnchorReaderOptions): AnchorReader {
  const registryAddress = options.registryAddress ?? DEFAULT_REGISTRY_ADDRESS;

  const publicClient =
    options.publicClient ??
    createPublicClient({
      chain: options.chain,
      transport: http(requireRpcUrl(options.rpcUrl)),
    });

  return {
    async getEpochCount(publisher: Hex): Promise<number> {
      const count = await publicClient.readContract({
        address: registryAddress,
        abi: REGISTRY_ABI,
        functionName: 'epochCount',
        args: [publisher],
      });
      return Number(count);
    },

    async getEpoch(publisher: Hex, index: number): Promise<AnchorEpoch> {
      const raw = await publicClient.readContract({
        address: registryAddress,
        abi: REGISTRY_ABI,
        functionName: 'getEpoch',
        args: [publisher, BigInt(index)],
      });
      return mapOnChainEpoch(index, raw);
    },

    async getLatestEpoch(publisher: Hex): Promise<AnchorEpoch> {
      const count = await publicClient.readContract({
        address: registryAddress,
        abi: REGISTRY_ABI,
        functionName: 'epochCount',
        args: [publisher],
      });
      const raw = await publicClient.readContract({
        address: registryAddress,
        abi: REGISTRY_ABI,
        functionName: 'latestEpoch',
        args: [publisher],
      });
      return mapOnChainEpoch(Number(count) - 1, raw);
    },
  };
}
