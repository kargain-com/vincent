import type { EpochBuild } from '@kargain/vincent-compiler';
import { gzipSync } from 'node:zlib';

import { buildManifest } from './build-manifest.js';
import { DEFAULT_GENESIS_REVIEW_POLICY } from './constants.js';
import {
  createIrysDevnetClient,
  type IrysDevnetClientOptions,
} from './adapters/irys-devnet-client.js';

const DEFAULT_COMPILER = { name: 'vincent-compiler', version: '0.0.1' } as const;
const PLACEHOLDER_JSONL_URI = 'ar://placeholderplaceholderplaceholderplaceholderpl';
const DEFAULT_UPLOAD_BUDGET_BUFFER_MULTIPLIER = 1.1;

export interface UploadBudgetCheckInput {
  estimatedCostWei: bigint;
  irysLoadedBalanceWei: bigint;
  walletBalanceWei: bigint;
  bufferMultiplier?: number;
}

export interface UploadBudgetCheckFailure {
  ok: false;
  requiredWei: bigint;
  availableWei: bigint;
  estimatedCostWei: bigint;
  irysLoadedBalanceWei: bigint;
  walletBalanceWei: bigint;
}

export type UploadBudgetCheckResult = { ok: true } | UploadBudgetCheckFailure;

function utf8Bytes(value: string): Uint8Array {
  return new TextEncoder().encode(value);
}

function applyBufferMultiplier(costWei: bigint, bufferMultiplier: number): bigint {
  if (!Number.isFinite(bufferMultiplier) || bufferMultiplier < 1) {
    throw new Error('bufferMultiplier must be a finite number >= 1');
  }
  const tenths = Math.round(bufferMultiplier * 10);
  return (costWei * BigInt(tenths)) / 10n;
}

/** Compare quoted upload cost against Irys funded balance plus unfunded wallet ETH. */
export function checkUploadBudgetSufficient(
  input: UploadBudgetCheckInput,
): UploadBudgetCheckResult {
  const bufferMultiplier = input.bufferMultiplier ?? DEFAULT_UPLOAD_BUDGET_BUFFER_MULTIPLIER;
  const requiredWei = applyBufferMultiplier(input.estimatedCostWei, bufferMultiplier);
  const availableWei = input.irysLoadedBalanceWei + input.walletBalanceWei;

  if (availableWei >= requiredWei) {
    return { ok: true };
  }

  return {
    ok: false,
    requiredWei,
    availableWei,
    estimatedCostWei: input.estimatedCostWei,
    irysLoadedBalanceWei: input.irysLoadedBalanceWei,
    walletBalanceWei: input.walletBalanceWei,
  };
}

function estimateManifestUploadBytes(
  epoch: EpochBuild,
  epochNumber: number,
  parentRoot: string | null,
): number {
  const unsigned = buildManifest({
    epoch: epochNumber,
    parentRoot,
    merkleRoot: epoch.merkleRoot,
    jsonlSha256: epoch.jsonlSha256,
    uris: [PLACEHOLDER_JSONL_URI],
    compiler: DEFAULT_COMPILER,
    reviewPolicy: {
      minAccepts: DEFAULT_GENESIS_REVIEW_POLICY.minAccepts,
      reviewers: ['0x0000000000000000000000000000000000000001'],
    },
  });
  // Signed manifest adds signature + hash fields beyond the unsigned shape.
  return utf8Bytes(JSON.stringify(unsigned)).length + 512;
}

/** Byte size of each permanent upload (one per leaf, plus JSONL and manifest). */
export function computeEpochUploadByteSizes(
  epoch: EpochBuild,
  epochNumber: number,
  parentRoot: string | null = null,
): number[] {
  const sizes: number[] = [];
  const sortedLeaves = [...epoch.leaves.entries()].sort(([a], [b]) => a.localeCompare(b));

  for (const [, entry] of sortedLeaves) {
    sizes.push(utf8Bytes(JSON.stringify({ leaf: entry.leaf, proof: entry.proof })).length);
  }

  sizes.push(gzipSync(utf8Bytes(epoch.jsonl)).length);
  sizes.push(estimateManifestUploadBytes(epoch, epochNumber, parentRoot));
  return sizes;
}

export interface AssertSufficientUploadBudgetOptions {
  privateKeyHex: string;
  rpcUrl: string;
  epoch: EpochBuild;
  epochNumber: number;
  parentRootContentId: string | null;
  walletBalanceWei: bigint;
  bufferMultiplier?: number;
  estimateUploadCostWei?: (byteSizes: readonly number[]) => Promise<bigint>;
  getIrysLoadedBalance?: () => Promise<bigint>;
  irysClientFactory?: (options: IrysDevnetClientOptions) => Promise<IrysQuoteClient>;
}

interface IrysQuoteClient {
  utils: {
    estimateFolderPrice: (byteSizes: number[]) => Promise<{ integerValue: () => { toString: () => string } }>;
  };
  getLoadedBalance: () => Promise<{ integerValue: () => { toString: () => string } }>;
}

function formatUploadBudgetFailure(failure: UploadBudgetCheckFailure): string {
  return (
    `Insufficient Ethereum Sepolia / Irys upload budget: ` +
    `quoted ${failure.estimatedCostWei.toString()} wei, ` +
    `need ${failure.requiredWei.toString()} wei with safety buffer, ` +
    `have ${failure.availableWei.toString()} wei ` +
    `(Irys funded ${failure.irysLoadedBalanceWei.toString()} wei + wallet ${failure.walletBalanceWei.toString()} wei). ` +
    `Fund the publisher on Ethereum Sepolia before publishing.`
  );
}

/** Abort before uploads when Irys price quote exceeds funded + wallet balance. */
export async function assertSufficientUploadBudget(
  options: AssertSufficientUploadBudgetOptions,
): Promise<void> {
  const byteSizes = computeEpochUploadByteSizes(
    options.epoch,
    options.epochNumber,
    options.parentRootContentId,
  );

  const estimatedCostWei =
    options.estimateUploadCostWei !== undefined
      ? await options.estimateUploadCostWei(byteSizes)
      : await quoteUploadCostFromIrys(
          options.privateKeyHex,
          options.rpcUrl,
          byteSizes,
          options.irysClientFactory,
        );

  const irysLoadedBalanceWei =
    options.getIrysLoadedBalance !== undefined
      ? await options.getIrysLoadedBalance()
      : await readIrysLoadedBalanceFromIrys(
          options.privateKeyHex,
          options.rpcUrl,
          options.irysClientFactory,
        );

  const result = checkUploadBudgetSufficient({
    estimatedCostWei,
    irysLoadedBalanceWei,
    walletBalanceWei: options.walletBalanceWei,
    bufferMultiplier: options.bufferMultiplier,
  });

  if (!result.ok) {
    throw new Error(formatUploadBudgetFailure(result));
  }
}

async function quoteUploadCostFromIrys(
  privateKeyHex: string,
  rpcUrl: string,
  byteSizes: readonly number[],
  irysClientFactory: NonNullable<AssertSufficientUploadBudgetOptions['irysClientFactory']> = createIrysDevnetClient,
): Promise<bigint> {
  const irys = await irysClientFactory({ privateKeyHex, rpcUrl });
  const quoted = await irys.utils.estimateFolderPrice([...byteSizes]);
  return BigInt(quoted.integerValue().toString());
}

async function readIrysLoadedBalanceFromIrys(
  privateKeyHex: string,
  rpcUrl: string,
  irysClientFactory: NonNullable<AssertSufficientUploadBudgetOptions['irysClientFactory']> = createIrysDevnetClient,
): Promise<bigint> {
  const irys = await irysClientFactory({ privateKeyHex, rpcUrl });
  const loaded = await irys.getLoadedBalance();
  return BigInt(loaded.integerValue().toString());
}
