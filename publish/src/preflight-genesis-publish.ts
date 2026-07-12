import { addressFromPrivateKey, toChecksumAddress } from '@kargain/vincent/protocol';
import { createPublicClient, http, parseEther } from 'viem';
import { baseSepolia, sepolia } from 'viem/chains';

import { createIrysDevnetUploader } from './adapters/irys-devnet-uploader.js';
import { assertGenesisPublisherAvailable, type EpochCountReader } from './assert-genesis-publisher.js';

/** Minimum Base Sepolia balance required before any permanent Arweave/Irys uploads. */
export const DEFAULT_MIN_CHAIN_BALANCE_WEI = parseEther('0.0001');
export const DEFAULT_MIN_IRYS_PAYMENT_BALANCE_WEI = parseEther('0.0001');

export interface GenesisPreflightOptions {
  rpcUrl: string;
  irysRpcUrl?: string;
  irysGraphqlUrl?: string;
  minChainBalanceWei?: bigint;
  minIrysPaymentBalanceWei?: bigint;
  /** Test override for RPC balance lookup. */
  getBalance?: (publisher: `0x${string}`) => Promise<bigint>;
  /** Test override for Ethereum Sepolia balance lookup used by Irys. */
  getIrysPaymentBalance?: (publisher: `0x${string}`) => Promise<bigint>;
  /** Test override for Irys wallet/RPC initialization (must not upload). */
  probeIrysUploader?: () => Promise<void>;
  /** Test override for Irys GraphQL availability. */
  probeIrysGraphql?: () => Promise<void>;
}

function formatError(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

async function defaultGetBalance(
  rpcUrl: string,
  publisher: `0x${string}`,
): Promise<bigint> {
  const client = createPublicClient({
    chain: baseSepolia,
    transport: http(rpcUrl),
  });
  return client.getBalance({ address: publisher });
}

async function defaultGetIrysPaymentBalance(
  rpcUrl: string,
  publisher: `0x${string}`,
): Promise<bigint> {
  const client = createPublicClient({
    chain: sepolia,
    transport: http(rpcUrl),
  });
  return client.getBalance({ address: publisher });
}

async function defaultProbeIrysUploader(
  privateKeyHex: `0x${string}`,
  rpcUrl: string,
): Promise<void> {
  await createIrysDevnetUploader({ privateKeyHex, rpcUrl });
}

async function defaultProbeIrysGraphql(
  graphqlUrl: string,
  publisher: string,
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
      { name: "Epoch", values: ["1"] }
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
  const publisher = toChecksumAddress(args.publisher);
  const derivedPublisher = toChecksumAddress(addressFromPrivateKey(args.privateKeyHex));
  if (derivedPublisher !== publisher) {
    throw new Error(
      `Private key derives ${derivedPublisher}, but expected publisher ${publisher}`,
    );
  }

  try {
    await assertGenesisPublisherAvailable(args.epochCountReader, publisher);
  } catch (error) {
    const message = formatError(error);
    if (message.includes('already has')) {
      throw error instanceof Error ? error : new Error(message);
    }
    throw new Error(`Registry epochCount check failed: ${message}`, { cause: error });
  }

  const minBalance = args.preflight.minChainBalanceWei ?? DEFAULT_MIN_CHAIN_BALANCE_WEI;
  const getBalance =
    args.preflight.getBalance ??
    ((address: `0x${string}`) => defaultGetBalance(args.preflight.rpcUrl, address));

  let balance: bigint;
  try {
    balance = await getBalance(publisher as `0x${string}`);
  } catch (error) {
    throw new Error(
      `Base Sepolia RPC unavailable (${args.preflight.rpcUrl}): ${formatError(error)}`,
      { cause: error },
    );
  }

  if (balance < minBalance) {
    throw new Error(
      `Insufficient Base Sepolia balance for ${publisher}: ` +
        `have ${balance.toString()} wei, need at least ${minBalance.toString()} wei for publishEpoch gas`,
    );
  }

  const irysRpcUrl = args.preflight.irysRpcUrl ?? args.preflight.rpcUrl;
  const minIrysBalance =
    args.preflight.minIrysPaymentBalanceWei ?? DEFAULT_MIN_IRYS_PAYMENT_BALANCE_WEI;
  const getIrysBalance =
    args.preflight.getIrysPaymentBalance ??
    ((address: `0x${string}`) => defaultGetIrysPaymentBalance(irysRpcUrl, address));
  let irysBalance: bigint;
  try {
    irysBalance = await getIrysBalance(publisher as `0x${string}`);
  } catch (error) {
    throw new Error(
      `Ethereum Sepolia RPC unavailable for Irys (${irysRpcUrl}): ${formatError(error)}`,
      { cause: error },
    );
  }
  if (irysBalance < minIrysBalance) {
    throw new Error(
      `Insufficient Ethereum Sepolia balance for Irys uploads from ${publisher}: ` +
        `have ${irysBalance.toString()} wei, need at least ${minIrysBalance.toString()} wei`,
    );
  }

  const probeIrys =
    args.preflight.probeIrysUploader ??
    (() => defaultProbeIrysUploader(args.privateKeyHex, irysRpcUrl));

  if (probeIrys !== undefined) {
    try {
      await probeIrys();
    } catch (error) {
      throw new Error(`Irys devnet uploader unavailable: ${formatError(error)}`, {
        cause: error,
      });
    }
  }

  const probeGraphql =
    args.preflight.probeIrysGraphql ??
    (args.preflight.irysGraphqlUrl === undefined
      ? undefined
      : () => defaultProbeIrysGraphql(args.preflight.irysGraphqlUrl!, publisher));
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
}
