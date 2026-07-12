import {
  createPublicClient,
  createWalletClient,
  http,
  type Account,
  type Abi,
  type Address,
  type Chain,
  type Hex,
  type PublicClient,
  type Transport,
  type WalletClient,
} from 'viem';
import { privateKeyToAccount } from 'viem/accounts';
import { baseSepolia } from 'viem/chains';

import { BASE_SEPOLIA_CHAIN_ID, REGISTRY_ADDRESS } from '../constants.js';
import type { EpochCountReader } from '../assert-genesis-publisher.js';
import type { ChainPublisher, PublishEpochArgs } from './types.js';

const REGISTRY_ABI = [
  {
    type: 'function',
    name: 'publishEpoch',
    stateMutability: 'nonpayable',
    inputs: [
      { name: 'merkleRoot', type: 'bytes32' },
      { name: 'jsonlSha256', type: 'bytes32' },
      { name: 'manifestHash', type: 'bytes32' },
      { name: 'parentRoot', type: 'bytes32' },
      { name: 'manifestUri', type: 'string' },
    ],
    outputs: [],
  },
  {
    type: 'function',
    name: 'latestEpoch',
    stateMutability: 'view',
    inputs: [{ name: 'publisher', type: 'address' }],
    outputs: [
      {
        name: 'epoch',
        type: 'tuple',
        components: [
          { name: 'merkleRoot', type: 'bytes32' },
          { name: 'jsonlSha256', type: 'bytes32' },
          { name: 'manifestHash', type: 'bytes32' },
          { name: 'parentRoot', type: 'bytes32' },
          { name: 'timestamp', type: 'uint64' },
          { name: 'manifestUri', type: 'string' },
        ],
      },
    ],
  },
  {
    type: 'function',
    name: 'epochCount',
    stateMutability: 'view',
    inputs: [{ name: 'publisher', type: 'address' }],
    outputs: [{ name: 'count', type: 'uint256' }],
  },
] as const satisfies Abi;

export interface BaseSepoliaPublisherOptions {
  privateKeyHex: Hex;
  rpcUrl?: string;
  registryAddress?: Address;
  chain?: Chain;
  publicClient?: PublicClient;
  walletClient?: WalletClient<Transport, Chain, Account>;
}

export interface OnChainEpoch {
  merkleRoot: Hex;
  jsonlSha256: Hex;
  manifestHash: Hex;
  parentRoot: Hex;
  timestamp: bigint;
  manifestUri: string;
}

export interface WaitForLatestEpochOptions {
  maxAttempts?: number;
  delayMs?: number;
}

export interface BaseSepoliaPublisher extends ChainPublisher, EpochCountReader {
  readLatestEpoch(publisher: Address): Promise<OnChainEpoch>;
  waitForLatestEpoch(
    publisher: Address,
    options?: WaitForLatestEpochOptions,
  ): Promise<OnChainEpoch>;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}

export interface BaseSepoliaReaderOptions {
  rpcUrl?: string;
  registryAddress?: Address;
  chain?: Chain;
  publicClient?: PublicClient;
}

function requireRpcUrl(rpcUrl: string | undefined): string {
  if (rpcUrl === undefined) {
    throw new Error('rpcUrl is required when no client is provided');
  }
  return rpcUrl;
}

/** Read-only registry access (verify-only CLI, no signing). */
export function createBaseSepoliaReader(
  options: BaseSepoliaReaderOptions,
): Pick<BaseSepoliaPublisher, 'readEpochCount' | 'readLatestEpoch' | 'waitForLatestEpoch'> {
  const registryAddress = (options.registryAddress ?? REGISTRY_ADDRESS);
  const chain = options.chain ?? baseSepolia;

  const publicClient =
    options.publicClient ??
    createPublicClient({
      chain,
      transport: http(requireRpcUrl(options.rpcUrl)),
    });

  return {
    async readEpochCount(publisher: Address): Promise<bigint> {
      return publicClient.readContract({
        address: registryAddress,
        abi: REGISTRY_ABI,
        functionName: 'epochCount',
        args: [publisher],
      });
    },

    async readLatestEpoch(publisher: Address): Promise<OnChainEpoch> {
      const epoch = await publicClient.readContract({
        address: registryAddress,
        abi: REGISTRY_ABI,
        functionName: 'latestEpoch',
        args: [publisher],
      });
      return epoch;
    },

    async waitForLatestEpoch(
      publisher: Address,
      waitOptions?: WaitForLatestEpochOptions,
    ): Promise<OnChainEpoch> {
      const maxAttempts = waitOptions?.maxAttempts ?? 15;
      const delayMs = waitOptions?.delayMs ?? 400;

      for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
        const count = await publicClient.readContract({
          address: registryAddress,
          abi: REGISTRY_ABI,
          functionName: 'epochCount',
          args: [publisher],
        });
        if (count > 0n) {
          return this.readLatestEpoch(publisher);
        }
        if (attempt < maxAttempts) {
          await sleep(delayMs);
        }
      }

      throw new Error(`Timed out waiting for on-chain epoch for publisher ${publisher}`);
    },
  };
}

/** VincentAnchorRegistry publisher (Base Sepolia by default). */
export function createBaseSepoliaPublisher(
  options: BaseSepoliaPublisherOptions,
): BaseSepoliaPublisher {
  const registryAddress = (options.registryAddress ?? REGISTRY_ADDRESS);
  const account = privateKeyToAccount(options.privateKeyHex);
  const chain = options.chain ?? baseSepolia;

  const publicClient =
    options.publicClient ??
    createPublicClient({
      chain,
      transport: http(requireRpcUrl(options.rpcUrl)),
    });

  const walletClient =
    options.walletClient ??
    createWalletClient({
      account,
      chain,
      transport: http(requireRpcUrl(options.rpcUrl)),
    });

  return {
    async publishEpoch(args: PublishEpochArgs): Promise<Hex> {
      const hash = await walletClient.writeContract({
        address: registryAddress,
        abi: REGISTRY_ABI,
        functionName: 'publishEpoch',
        args: [
          args.merkleRoot,
          args.jsonlSha256,
          args.manifestHash,
          args.parentRoot,
          args.manifestUri,
        ],
        chain,
      });

      const receipt = await publicClient.waitForTransactionReceipt({ hash });
      if (receipt.status !== 'success') {
        throw new Error(`publishEpoch transaction reverted: ${hash}`);
      }
      return hash;
    },

    async readEpochCount(publisher: Address): Promise<bigint> {
      return publicClient.readContract({
        address: registryAddress,
        abi: REGISTRY_ABI,
        functionName: 'epochCount',
        args: [publisher],
      });
    },

    async readLatestEpoch(publisher: Address): Promise<OnChainEpoch> {
      const epoch = await publicClient.readContract({
        address: registryAddress,
        abi: REGISTRY_ABI,
        functionName: 'latestEpoch',
        args: [publisher],
      });
      return epoch;
    },

    async waitForLatestEpoch(
      publisher: Address,
      options?: WaitForLatestEpochOptions,
    ): Promise<OnChainEpoch> {
      const maxAttempts = options?.maxAttempts ?? 15;
      const delayMs = options?.delayMs ?? 400;

      for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
        const count = await publicClient.readContract({
          address: registryAddress,
          abi: REGISTRY_ABI,
          functionName: 'epochCount',
          args: [publisher],
        });
        if (count > 0n) {
          return this.readLatestEpoch(publisher);
        }
        if (attempt < maxAttempts) {
          await sleep(delayMs);
        }
      }

      throw new Error(`Timed out waiting for on-chain epoch for publisher ${publisher}`);
    },
  };
}

export { BASE_SEPOLIA_CHAIN_ID, REGISTRY_ADDRESS };
