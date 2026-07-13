import type { EpochBuild } from '@kargain/vincent-compiler';
import { parseEther } from 'viem';
import { gzipSync } from 'node:zlib';

import { buildManifest } from './build-manifest.js';
import { DEFAULT_GENESIS_REVIEW_POLICY } from './constants.js';
import {
  createIrysDevnetClient,
  type IrysDevnetClientOptions,
} from './adapters/irys-devnet-client.js';
import {
  fundIrysDevnetAccount,
  recoverIrysFundTransaction,
  type IrysDevnetClient,
} from './adapters/irys-devnet-fund.js';

const DEFAULT_COMPILER = { name: 'vincent-compiler', version: '0.0.1' } as const;
const PLACEHOLDER_JSONL_URI = 'ar://placeholderplaceholderplaceholderplaceholderpl';
const DEFAULT_UPLOAD_BUDGET_BUFFER_MULTIPLIER = 1.1;
/** Base Sepolia ETH reserved for the Irys fund() transaction gas. */
export const DEFAULT_IRYS_FUNDING_GAS_RESERVE_WEI = parseEther('0.001');

export interface UploadBudgetCheckInput {
  estimatedCostWei: bigint;
  irysLoadedBalanceWei: bigint;
  walletBalanceWei: bigint;
  bufferMultiplier?: number;
  fundingGasReserveWei?: bigint;
}

export interface UploadBudgetCheckFailure {
  ok: false;
  requiredWei: bigint;
  deficitWei: bigint;
  fundingReserveWei: bigint;
  walletNeededWei: bigint;
  irysLoadedBalanceWei: bigint;
  walletBalanceWei: bigint;
  estimatedCostWei: bigint;
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

/** Whether Irys is already funded or the wallet can fund the remaining deficit. */
export function checkUploadBudgetSufficient(
  input: UploadBudgetCheckInput,
): UploadBudgetCheckResult {
  const bufferMultiplier = input.bufferMultiplier ?? DEFAULT_UPLOAD_BUDGET_BUFFER_MULTIPLIER;
  const fundingReserveWei = input.fundingGasReserveWei ?? DEFAULT_IRYS_FUNDING_GAS_RESERVE_WEI;
  const requiredWei = applyBufferMultiplier(input.estimatedCostWei, bufferMultiplier);

  if (input.irysLoadedBalanceWei >= requiredWei) {
    return { ok: true };
  }

  const deficitWei = requiredWei - input.irysLoadedBalanceWei;
  const walletNeededWei = deficitWei + fundingReserveWei;

  if (input.walletBalanceWei >= walletNeededWei) {
    return { ok: true };
  }

  return {
    ok: false,
    requiredWei,
    deficitWei,
    fundingReserveWei,
    walletNeededWei,
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

export interface RemainingUploadByteSizesInput {
  epoch: EpochBuild;
  epochNumber: number;
  parentRoot: string | null;
  completedLeafKeys?: ReadonlySet<string>;
  includeJsonl?: boolean;
  includeManifest?: boolean;
}

/** Byte sizes for leaves and artifacts not yet recorded in checkpoint. */
export function computeRemainingUploadByteSizes(input: RemainingUploadByteSizesInput): number[] {
  const sizes: number[] = [];
  const completed = input.completedLeafKeys ?? new Set<string>();
  const sortedLeaves = [...input.epoch.leaves.entries()].sort(([a], [b]) => a.localeCompare(b));

  for (const [leafKey, entry] of sortedLeaves) {
    if (completed.has(leafKey)) continue;
    sizes.push(utf8Bytes(JSON.stringify({ leaf: entry.leaf, proof: entry.proof })).length);
  }

  if (input.includeJsonl !== false) {
    sizes.push(gzipSync(utf8Bytes(input.epoch.jsonl)).length);
  }
  if (input.includeManifest !== false) {
    sizes.push(estimateManifestUploadBytes(input.epoch, input.epochNumber, input.parentRoot));
  }
  return sizes;
}

export interface EnsureIrysUploadBudgetOptions {
  /** When set, quote only these byte sizes instead of the full epoch. */
  byteSizes?: readonly number[];
  privateKeyHex: string;
  rpcUrl: string;
  epoch: EpochBuild;
  epochNumber: number;
  parentRootContentId: string | null;
  walletBalanceWei: bigint;
  bufferMultiplier?: number;
  fundingGasReserveWei?: bigint;
  estimateUploadCostWei?: (byteSizes: readonly number[]) => Promise<bigint>;
  getIrysLoadedBalance?: () => Promise<bigint>;
  fundIrys?: (deficitWei: bigint) => Promise<void>;
  onFund?: (deficitWei: bigint) => void;
  /** Optional hook after quoting (e.g. CLI progress). */
  onQuote?: (quote: UploadBudgetQuote) => void;
  /** When set, register this confirmed Sepolia fund tx before sending a new one. */
  recoverFundTxId?: `0x${string}`;
  onFundTxSubmitted?: (txId: `0x${string}`) => void;
  fundIrysDevnetAccount?: (
    irys: IrysDevnetClient,
    amountWei: bigint,
    rpcUrl: string,
  ) => Promise<void>;
  irysClientFactory?: (options: IrysDevnetClientOptions) => Promise<IrysQuoteClient>;
}

export interface UploadBudgetQuote {
  estimatedCostWei: bigint;
  requiredWei: bigint;
  irysLoadedBalanceWei: bigint;
  walletBalanceWei: bigint;
  deficitWei: bigint;
}

interface IrysQuoteClient {
  utils: {
    estimateFolderPrice: (byteSizes: number[]) => Promise<{ integerValue: () => { toString: () => string } }>;
  };
  getLoadedBalance: () => Promise<{ integerValue: () => { toString: () => string } }>;
  fund: (amount: string | number | bigint) => Promise<unknown>;
}

function formatUploadBudgetFailure(failure: UploadBudgetCheckFailure): string {
  return (
    `Insufficient Base Sepolia / Irys upload budget: ` +
    `quoted ${failure.estimatedCostWei.toString()} wei, ` +
    `need ${failure.requiredWei.toString()} wei on Irys (funded ${failure.irysLoadedBalanceWei.toString()} wei), ` +
    `wallet must cover ${failure.walletNeededWei.toString()} wei to fund the ${failure.deficitWei.toString()} wei deficit ` +
    `(includes ${failure.fundingReserveWei.toString()} wei gas reserve) but have ${failure.walletBalanceWei.toString()} wei. ` +
    `Fund the publisher on Base Sepolia before publishing.`
  );
}

async function readLoadedBalanceWei(
  readBalance: () => Promise<{ integerValue: () => { toString: () => string } }>,
): Promise<bigint> {
  const loaded = await readBalance();
  return BigInt(loaded.integerValue().toString());
}

/** Quote upload cost, fund Irys when needed, and verify funded balance before uploads. */
export async function ensureIrysUploadBudget(
  options: EnsureIrysUploadBudgetOptions,
): Promise<void> {
  const byteSizes =
    options.byteSizes ??
    computeEpochUploadByteSizes(
      options.epoch,
      options.epochNumber,
      options.parentRootContentId,
    );

  const irysClientFactory = options.irysClientFactory ?? createIrysDevnetClient;
  const needsIrysClient =
    options.estimateUploadCostWei === undefined || options.getIrysLoadedBalance === undefined;

  let irys: IrysQuoteClient | undefined;
  if (needsIrysClient) {
    irys = await irysClientFactory({
      privateKeyHex: options.privateKeyHex,
      rpcUrl: options.rpcUrl,
    });
  }

  const estimatedCostWei =
    options.estimateUploadCostWei !== undefined
      ? await options.estimateUploadCostWei(byteSizes)
      : await quoteUploadCostFromClient(irys!, byteSizes);

  const readLoaded =
    options.getIrysLoadedBalance !== undefined
      ? async () => BigInt((await options.getIrysLoadedBalance!()).toString())
      : async () => readLoadedBalanceWei(() => irys!.getLoadedBalance());

  let irysLoadedBalanceWei = await readLoaded();
  const fundingReserveWei = options.fundingGasReserveWei ?? DEFAULT_IRYS_FUNDING_GAS_RESERVE_WEI;
  const requiredWei = applyBufferMultiplier(
    estimatedCostWei,
    options.bufferMultiplier ?? DEFAULT_UPLOAD_BUDGET_BUFFER_MULTIPLIER,
  );
  const deficitWei =
    irysLoadedBalanceWei >= requiredWei ? 0n : requiredWei - irysLoadedBalanceWei;

  options.onQuote?.({
    estimatedCostWei,
    requiredWei,
    irysLoadedBalanceWei,
    walletBalanceWei: options.walletBalanceWei,
    deficitWei,
  });

  const initialCheck = checkUploadBudgetSufficient({
    estimatedCostWei,
    irysLoadedBalanceWei,
    walletBalanceWei: options.walletBalanceWei,
    bufferMultiplier: options.bufferMultiplier,
    fundingGasReserveWei: fundingReserveWei,
  });

  if (!initialCheck.ok) {
    throw new Error(formatUploadBudgetFailure(initialCheck));
  }

  if (irysLoadedBalanceWei >= requiredWei) {
    return;
  }

  if (options.recoverFundTxId !== undefined) {
    if (irys === undefined) {
      irys = await irysClientFactory({
        privateKeyHex: options.privateKeyHex,
        rpcUrl: options.rpcUrl,
      });
    }
    await recoverIrysFundTransaction(irys as IrysDevnetClient, options.recoverFundTxId, options.rpcUrl, {
      readLoadedBalance: readLoaded,
      requiredLoadedWei: requiredWei,
    });
    irysLoadedBalanceWei = await readLoaded();
    if (irysLoadedBalanceWei >= requiredWei) {
      return;
    }
  }

  const fundDeficitWei = requiredWei - irysLoadedBalanceWei;
  options.onFund?.(fundDeficitWei);

  if (options.fundIrys !== undefined) {
    await options.fundIrys(fundDeficitWei);
  } else {
    if (irys === undefined) {
      irys = await irysClientFactory({
        privateKeyHex: options.privateKeyHex,
        rpcUrl: options.rpcUrl,
      });
    }
    const fundAccount = options.fundIrysDevnetAccount ?? (async (client, amountWei, rpcUrl) => {
      await fundIrysDevnetAccount(client, amountWei, rpcUrl, {
        onTxSubmitted: options.onFundTxSubmitted,
        readLoadedBalance: readLoaded,
        requiredLoadedWei: requiredWei,
      });
    });
    await fundAccount(irys as IrysDevnetClient, fundDeficitWei, options.rpcUrl);
  }

  irysLoadedBalanceWei = await readLoaded();
  if (irysLoadedBalanceWei < requiredWei) {
    throw new Error(
      `Irys funding incomplete: funded balance ${irysLoadedBalanceWei.toString()} wei ` +
        `is below required ${requiredWei.toString()} wei after fund()`,
    );
  }
}

async function quoteUploadCostFromClient(
  irys: IrysQuoteClient,
  byteSizes: readonly number[],
): Promise<bigint> {
  const quoted = await irys.utils.estimateFolderPrice([...byteSizes]);
  return BigInt(quoted.integerValue().toString());
}
