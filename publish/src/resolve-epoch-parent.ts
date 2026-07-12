import type { OnChainEpoch } from './adapters/base-sepolia-publisher.js';
import { bytes32ToContentId, ZERO_BYTES32 } from './adapters/sha256-bytes32.js';
import type { EpochCountReader } from './assert-genesis-publisher.js';

export interface EpochChainReader extends EpochCountReader {
  readLatestEpoch(publisher: `0x${string}`): Promise<OnChainEpoch>;
}

export interface ResolvedEpochParent {
  epochNumber: number;
  parentRootBytes32: `0x${string}`;
  parentRootContentId: string | null;
}

/** Derive epoch number and parentRoot from on-chain publisher state. */
export async function resolveEpochParent(
  reader: EpochChainReader,
  publisher: `0x${string}`,
): Promise<ResolvedEpochParent> {
  const epochCount = await reader.readEpochCount(publisher);

  if (epochCount === 0n) {
    return {
      epochNumber: 1,
      parentRootBytes32: ZERO_BYTES32,
      parentRootContentId: null,
    };
  }

  const latest = await reader.readLatestEpoch(publisher);
  const parentRootContentId = bytes32ToContentId(latest.merkleRoot);

  return {
    epochNumber: Number(epochCount) + 1,
    parentRootBytes32: latest.merkleRoot,
    parentRootContentId,
  };
}
