import BigNumber from 'bignumber.js';
import { createPublicClient, http } from 'viem';
import { baseSepolia } from 'viem/chains';

import { IRYS_FUND_FEE_MULTIPLIER } from '../constants.js';
import type { createIrysDevnetClient } from './irys-devnet-client.js';

export type IrysDevnetClient = Awaited<ReturnType<typeof createIrysDevnetClient>>;

const DEFAULT_FUND_CONFIRMATION_TIMEOUT_MS = 180_000;
const DEFAULT_BUNDLER_POST_ATTEMPTS = 10;
const DEFAULT_LOADED_BALANCE_POLL_MS = 60_000;
const BUNDLER_POST_RETRY_BASE_MS = 2_000;
const BUNDLER_POST_RETRY_MAX_MS = 15_000;
const LOADED_BALANCE_POLL_INTERVAL_MS = 2_000;

export interface IrysDevnetFundOptions {
  confirmationTimeoutMs?: number;
  bundlerPostAttempts?: number;
  loadedBalancePollMs?: number;
  onTxSubmitted?: (txId: `0x${string}`) => void;
  waitForTransactionReceipt?: (
    txId: `0x${string}`,
    rpcUrl: string,
    timeoutMs: number,
  ) => Promise<unknown>;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function bundlerPostDelayMs(attempt: number): number {
  return Math.min(BUNDLER_POST_RETRY_BASE_MS * attempt, BUNDLER_POST_RETRY_MAX_MS);
}

async function defaultWaitForTransactionReceipt(
  txId: `0x${string}`,
  rpcUrl: string,
  timeoutMs: number,
): Promise<unknown> {
  const publicClient = createPublicClient({
    chain: baseSepolia,
    transport: http(rpcUrl),
  });

  return publicClient.waitForTransactionReceipt({
    hash: txId,
    timeout: timeoutMs,
  });
}

/** Post a confirmed Base Sepolia fund tx to the Irys bundler (retries while the node indexes). */
export async function submitIrysFundTransaction(
  irys: IrysDevnetClient,
  txId: string,
  options?: { maxAttempts?: number },
): Promise<void> {
  const maxAttempts = options?.maxAttempts ?? DEFAULT_BUNDLER_POST_ATTEMPTS;
  let lastError: unknown;

  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      await irys.funder.submitFundTransaction(txId);
      return;
    } catch (error) {
      lastError = error;
      if (attempt < maxAttempts) {
        await sleep(bundlerPostDelayMs(attempt));
      }
    }
  }

  throw lastError instanceof Error
    ? lastError
    : new Error(`Failed to post Irys fund transaction ${txId} to bundler`);
}

async function waitForIrysLoadedBalance(
  readLoaded: () => Promise<bigint>,
  requiredWei: bigint,
  timeoutMs: number,
): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const balance = await readLoaded();
    if (balance >= requiredWei) {
      return;
    }
    await sleep(LOADED_BALANCE_POLL_INTERVAL_MS);
  }

  throw new Error(
    `Irys funded balance did not reach ${requiredWei.toString()} wei within ${String(timeoutMs)}ms`,
  );
}

/** Wait for Base Sepolia confirmation, register with Irys, then poll funded balance. */
export async function fundIrysDevnetAccount(
  irys: IrysDevnetClient,
  amountWei: bigint,
  rpcUrl: string,
  options?: IrysDevnetFundOptions & {
    readLoadedBalance?: () => Promise<bigint>;
    requiredLoadedWei?: bigint;
  },
): Promise<{ txId: `0x${string}` }> {
  const amount = new BigNumber(amountWei.toString());
  if (!amount.isInteger()) {
    throw new Error('Irys fund amount must be an integer number of wei');
  }

  const tokenConfig = irys.tokenConfig;
  const to = await irys.utils.getBundlerAddress(irys.token);
  const fee = tokenConfig.needsFee
    ? await tokenConfig.getFee(amount, to, IRYS_FUND_FEE_MULTIPLIER)
    : undefined;
  const tx = await tokenConfig.createTx(amount, to, fee);
  const sendTxRes = await tokenConfig.sendTx(tx.tx);
  const txId = (tx.txId ?? sendTxRes) as `0x${string}`;
  if (!txId) {
    throw new Error('Irys fund transaction id is undefined after broadcast');
  }

  options?.onTxSubmitted?.(txId);

  const waitForReceipt = options?.waitForTransactionReceipt ?? defaultWaitForTransactionReceipt;
  await waitForReceipt(
    txId,
    rpcUrl,
    options?.confirmationTimeoutMs ?? DEFAULT_FUND_CONFIRMATION_TIMEOUT_MS,
  );

  await submitIrysFundTransaction(irys, txId, {
    maxAttempts: options?.bundlerPostAttempts,
  });

  if (options?.readLoadedBalance !== undefined && options.requiredLoadedWei !== undefined) {
    await waitForIrysLoadedBalance(
      options.readLoadedBalance,
      options.requiredLoadedWei,
      options.loadedBalancePollMs ?? DEFAULT_LOADED_BALANCE_POLL_MS,
    );
  }

  return { txId };
}

/** Register an already-confirmed Base Sepolia fund tx with the Irys bundler (recovery path). */
export async function recoverIrysFundTransaction(
  irys: IrysDevnetClient,
  txId: `0x${string}`,
  rpcUrl: string,
  options?: Omit<IrysDevnetFundOptions, 'onTxSubmitted'> & {
    readLoadedBalance?: () => Promise<bigint>;
    requiredLoadedWei?: bigint;
  },
): Promise<void> {
  const waitForReceipt = options?.waitForTransactionReceipt ?? defaultWaitForTransactionReceipt;
  await waitForReceipt(
    txId,
    rpcUrl,
    options?.confirmationTimeoutMs ?? DEFAULT_FUND_CONFIRMATION_TIMEOUT_MS,
  );

  await submitIrysFundTransaction(irys, txId, {
    maxAttempts: options?.bundlerPostAttempts,
  });

  if (options?.readLoadedBalance !== undefined && options.requiredLoadedWei !== undefined) {
    await waitForIrysLoadedBalance(
      options.readLoadedBalance,
      options.requiredLoadedWei,
      options.loadedBalancePollMs ?? DEFAULT_LOADED_BALANCE_POLL_MS,
    );
  }
}
