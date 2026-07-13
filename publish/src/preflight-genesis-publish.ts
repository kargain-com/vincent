import { addressFromPrivateKey, toChecksumAddress } from '@kargain/vincent/protocol';
import { createPublicClient, http, parseEther, type Chain } from 'viem';
import { baseSepolia } from 'viem/chains';

import { createIrysUploader } from './adapters/irys-uploader.js';
import { BASE_SEPOLIA_CHAIN_ID } from './constants.js';
import { assertGenesisPublisherAvailable, type EpochCountReader } from './assert-genesis-publisher.js';
import {
  ensureIrysUploadBudget,
  type EnsureIrysUploadBudgetOptions,
} from './estimate-epoch-upload-cost.js';
import type { EpochChainReader } from './resolve-epoch-parent.js';
import type { EpochBuild } from '@kargain/vincent-compiler';
import type { PublishNetworkId } from './publish-network.js';
import { resolvePublishNetwork } from './publish-network.js';

/** Minimum Base Sepolia balance required before any permanent Arweave/Irys uploads. */
export const DEFAULT_MIN_CHAIN_BALANCE_WEI = parseEther('0.0001');

export interface GenesisPreflightOptions {
  rpcUrl: string;
  chainId?: number;
  chain?: Chain;
  networkId?: PublishNetworkId;
  irysGraphqlUrl?: string;
  minChainBalanceWei?: bigint;
  /** Test override for Base Sepolia balance lookup (anchor gas + Irys funding). */
  getBalance?: (publisher: `0x${string}`) => Promise<bigint>;
  /** Test override for Irys wallet/RPC initialization (must not upload). */
  probeIrysUploader?: () => Promise<void>;
  /** Test override for Irys GraphQL availability. */
  probeIrysGraphql?: () => Promise<void>;
}

export interface EpochUploadBudgetPreflight {
  epoch: EpochBuild;
  epochNumber: number;
  parentRootContentId: string | null;
  bufferMultiplier?: number;
  fundingGasReserveWei?: bigint;
  estimateUploadCostWei?: EnsureIrysUploadBudgetOptions['estimateUploadCostWei'];
  getIrysLoadedBalance?: EnsureIrysUploadBudgetOptions['getIrysLoadedBalance'];
  fundIrys?: EnsureIrysUploadBudgetOptions['fundIrys'];
  onFund?: EnsureIrysUploadBudgetOptions['onFund'];
  onQuote?: EnsureIrysUploadBudgetOptions['onQuote'];
  recoverFundTxId?: EnsureIrysUploadBudgetOptions['recoverFundTxId'];
  onFundTxSubmitted?: EnsureIrysUploadBudgetOptions['onFundTxSubmitted'];
  /** When set, quote only these byte sizes (partial checkpoint resume). */
  byteSizes?: readonly number[];
  /** Optional hook when upload-budget quoting begins (e.g. CLI progress). */
  onStart?: (leafCount: number) => void;
}

export interface EpochPreflightOptions extends GenesisPreflightOptions {
  /** When true, abort if publisher already has on-chain epochs. */
  requireGenesis?: boolean;
  /** Epoch tag for Irys GraphQL probe (defaults to 1). */
  targetEpochNumber?: number;
  /** When set, quote Irys upload cost and abort before any permanent uploads. */
  uploadBudget?: EpochUploadBudgetPreflight;
}

function formatError(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

async function defaultGetBalance(
  rpcUrl: string,
  chain: Chain,
  publisher: `0x${string}`,
): Promise<bigint> {
  const client = createPublicClient({
    chain,
    transport: http(rpcUrl),
  });
  return client.getBalance({ address: publisher });
}

async function defaultProbeIrysUploader(
  privateKeyHex: `0x${string}`,
  rpcUrl: string,
  chainId: number,
): Promise<void> {
  await createIrysUploader({ privateKeyHex, rpcUrl, chainId });
}

async function defaultProbeIrysGraphql(
  graphqlUrl: string,
  publisher: string,
  targetEpochNumber: number,
): Promise<void> {
  const owner = publisher.toLowerCase();
  const response = await fetch(graphqlUrl, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      query: `query {
  transactions(
    owners: ["${owner}"]
    tags: [
      { name: "App", values: ["vincent"] }
      { name: "Epoch", values: ["${String(targetEpochNumber)}"] }
    ]
    order: DESC
    first: 1
  ) {
    edges {
      node {
        id
      }
    }
  }
}`,
    }),
  });
  if (!response.ok) {
    throw new Error(`HTTP ${String(response.status)}`);
  }
  const payload = (await response.json()) as {
    errors?: Array<{ message?: string }>;
    data?: unknown;
  };
  if (payload.errors !== undefined && payload.errors.length > 0) {
    throw new Error(payload.errors.map((error) => error.message ?? 'unknown error').join('; '));
  }
  if (payload.data === undefined) {
    throw new Error('response has no data');
  }
}

/**
 * Validate wallet, RPC, chain balance, registry epochCount, and Irys connectivity
 * before any permanent uploads or on-chain publish.
 */
export async function preflightGenesisPublish(args: {
  privateKeyHex: `0x${string}`;
  publisher: string;
  epochCountReader: EpochCountReader;
  preflight: GenesisPreflightOptions;
}): Promise<void> {
  await preflightEpochPublish({
    privateKeyHex: args.privateKeyHex,
    publisher: args.publisher,
    epochCountReader: args.epochCountReader,
    preflight: { ...args.preflight, requireGenesis: true, targetEpochNumber: 1 },
  });
}

async function runRegistryPreflight(
  epochCountReader: EpochCountReader,
  publisher: string,
  preflight: EpochPreflightOptions,
  readLatestEpoch?: EpochChainReader['readLatestEpoch'],
): Promise<void> {
  if (preflight.requireGenesis === true) {
    try {
      await assertGenesisPublisherAvailable(epochCountReader, publisher);
    } catch (error) {
      const message = formatError(error);
      if (message.includes('already has')) {
        throw error instanceof Error ? error : new Error(message);
      }
      throw new Error(`Registry epochCount check failed: ${message}`, { cause: error });
    }
    return;
  }

  try {
    const count = await epochCountReader.readEpochCount(publisher as `0x${string}`);
    if (count > 0n) {
      if (readLatestEpoch === undefined) {
        throw new Error('Incremental preflight requires chainReader with readLatestEpoch');
      }
      await readLatestEpoch(publisher as `0x${string}`);
    }
  } catch (error) {
    if (error instanceof Error && error.message.includes('Incremental preflight requires')) {
      throw error;
    }
    throw new Error(`Registry latest epoch check failed: ${formatError(error)}`, {
      cause: error,
    });
  }
}

async function runSharedPreflight(args: {
  privateKeyHex: `0x${string}`;
  publisher: string;
  preflight: EpochPreflightOptions;
}): Promise<{ walletBalanceWei: bigint }> {
  const publisher = toChecksumAddress(args.publisher);
  const derivedPublisher = toChecksumAddress(addressFromPrivateKey(args.privateKeyHex));
  if (derivedPublisher !== publisher) {
    throw new Error(
      `Private key derives ${derivedPublisher}, but expected publisher ${publisher}`,
    );
  }

  const network =
    args.preflight.networkId !== undefined
      ? resolvePublishNetwork(args.preflight.networkId)
      : undefined;
  const chainId = args.preflight.chainId ?? network?.chainId ?? BASE_SEPOLIA_CHAIN_ID;
  const chain = args.preflight.chain ?? network?.chain ?? baseSepolia;
  const chainLabel = chain.name ?? `chain ${String(chainId)}`;

  const minBalance = args.preflight.minChainBalanceWei ?? DEFAULT_MIN_CHAIN_BALANCE_WEI;
  const getBalance =
    args.preflight.getBalance ??
    ((address: `0x${string}`) => defaultGetBalance(args.preflight.rpcUrl, chain, address));

  let balance: bigint;
  try {
    balance = await getBalance(publisher as `0x${string}`);
  } catch (error) {
    throw new Error(
      `${chainLabel} RPC unavailable (${args.preflight.rpcUrl}): ${formatError(error)}`,
      { cause: error },
    );
  }

  if (balance < minBalance) {
    throw new Error(
      `Insufficient ${chainLabel} balance for ${publisher}: ` +
        `have ${balance.toString()} wei, need at least ${minBalance.toString()} wei ` +
        `for publishEpoch gas and Irys uploads`,
    );
  }

  const probeIrys =
    args.preflight.probeIrysUploader ??
    (() => defaultProbeIrysUploader(args.privateKeyHex, args.preflight.rpcUrl, chainId));

  try {
    await probeIrys();
  } catch (error) {
    throw new Error(`Irys uploader unavailable on ${chainLabel}: ${formatError(error)}`, {
      cause: error,
    });
  }

  const targetEpochNumber = args.preflight.targetEpochNumber ?? 1;
  const probeGraphql =
    args.preflight.probeIrysGraphql ??
    (args.preflight.irysGraphqlUrl === undefined
      ? undefined
      : () =>
          defaultProbeIrysGraphql(args.preflight.irysGraphqlUrl!, publisher, targetEpochNumber));
  if (probeGraphql !== undefined) {
    try {
      await probeGraphql();
    } catch (error) {
      throw new Error(
        `Irys GraphQL unavailable (${args.preflight.irysGraphqlUrl ?? 'configured endpoint'}): ${formatError(error)}`,
        { cause: error },
      );
    }
  }

  return { walletBalanceWei: balance };
}

/**
 * Validate wallet, RPC, balances, registry state, and Irys connectivity before uploads.
 * Genesis mode (`requireGenesis: true`) aborts when epochCount > 0; incremental mode
 * confirms the prior epoch is readable instead.
 */
export async function preflightEpochPublish(args: {
  privateKeyHex: `0x${string}`;
  publisher: string;
  epochCountReader: EpochCountReader;
  preflight: EpochPreflightOptions;
  readLatestEpoch?: EpochChainReader['readLatestEpoch'];
}): Promise<void> {
  const publisher = toChecksumAddress(args.publisher);
  const network =
    args.preflight.networkId !== undefined
      ? resolvePublishNetwork(args.preflight.networkId)
      : undefined;

  await runRegistryPreflight(
    args.epochCountReader,
    publisher,
    args.preflight,
    args.readLatestEpoch,
  );
  const { walletBalanceWei } = await runSharedPreflight({
    privateKeyHex: args.privateKeyHex,
    publisher,
    preflight: args.preflight,
  });

  if (args.preflight.uploadBudget !== undefined) {
    args.preflight.uploadBudget.onStart?.(args.preflight.uploadBudget.epoch.leaves.size);
    await ensureIrysUploadBudget({
      privateKeyHex: args.privateKeyHex,
      rpcUrl: args.preflight.rpcUrl,
      chainId: args.preflight.chainId ?? network?.chainId,
      chain: args.preflight.chain ?? network?.chain,
      networkId: args.preflight.networkId,
      epoch: args.preflight.uploadBudget.epoch,
      epochNumber: args.preflight.uploadBudget.epochNumber,
      parentRootContentId: args.preflight.uploadBudget.parentRootContentId,
      walletBalanceWei,
      bufferMultiplier: args.preflight.uploadBudget.bufferMultiplier,
      fundingGasReserveWei: args.preflight.uploadBudget.fundingGasReserveWei,
      estimateUploadCostWei: args.preflight.uploadBudget.estimateUploadCostWei,
      getIrysLoadedBalance: args.preflight.uploadBudget.getIrysLoadedBalance,
      fundIrys: args.preflight.uploadBudget.fundIrys,
      onFund: args.preflight.uploadBudget.onFund,
      onQuote: args.preflight.uploadBudget.onQuote,
      recoverFundTxId: args.preflight.uploadBudget.recoverFundTxId,
      onFundTxSubmitted: args.preflight.uploadBudget.onFundTxSubmitted,
      byteSizes: args.preflight.uploadBudget.byteSizes,
    });
  }
}
