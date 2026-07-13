import { network } from 'hardhat';
import type { Address, Hex } from 'viem';
import { hardhat } from 'viem/chains';
import { mnemonicToAccount } from 'viem/accounts';

import {
  createBaseSepoliaPublisher,
  createBaseSepoliaReader,
  type BaseSepoliaPublisher,
} from '../src/adapters/base-sepolia-publisher.js';
import {
  createRegistryPublisher,
  type RegistryPublisher,
} from '../src/adapters/registry-publisher.js';

const HARDHAT_MNEMONIC = 'test test test test test test test test test test test junk';
const ACCOUNT_COUNT = 20;

export interface LocalChainAccount {
  address: Address;
  privateKeyHex: Hex;
}

export interface LocalChainHarness {
  registryAddress: Address;
  getAccount(index: number): LocalChainAccount;
  createPublisher(index: number): BaseSepoliaPublisher;
  createRegistryPublisher(index: number): RegistryPublisher;
  createReader(): Pick<
    BaseSepoliaPublisher,
    'readEpochCount' | 'readLatestEpoch' | 'waitForLatestEpoch'
  >;
}

let harnessPromise: Promise<LocalChainHarness> | undefined;

async function createHarness(): Promise<LocalChainHarness> {
  const { viem } = await network.create();
  const publicClient = await viem.getPublicClient();
  const walletClients = await viem.getWalletClients();
  const registry = await viem.deployContract('VincentAnchorRegistry');

  const accounts = Array.from({ length: ACCOUNT_COUNT }, (_, index) => {
    const account = mnemonicToAccount(HARDHAT_MNEMONIC, { addressIndex: index });
    const walletClient = walletClients[index];
    if (walletClient?.account === undefined) {
      throw new Error(`Hardhat wallet account ${String(index)} is unavailable`);
    }
    if (walletClient.account.address.toLowerCase() !== account.address.toLowerCase()) {
      throw new Error(`Hardhat wallet account ${String(index)} does not match default mnemonic`);
    }
    const privateKey = account.getHdKey().privateKey;
    if (privateKey === null) {
      throw new Error(`Hardhat private key ${String(index)} is unavailable`);
    }
    return {
      address: account.address,
      privateKeyHex: `0x${Buffer.from(privateKey).toString('hex')}`,
      walletClient,
    };
  });

  return {
    registryAddress: registry.address,

    getAccount(index: number): LocalChainAccount {
      const account = accounts[index];
      if (account === undefined) {
        throw new Error(`Local chain account index ${String(index)} is out of range`);
      }
      return { address: account.address, privateKeyHex: account.privateKeyHex };
    },

    createPublisher(index: number): BaseSepoliaPublisher {
      const account = accounts[index];
      if (account === undefined) {
        throw new Error(`Local chain account index ${String(index)} is out of range`);
      }
      return createBaseSepoliaPublisher({
        privateKeyHex: account.privateKeyHex,
        registryAddress: registry.address,
        chain: hardhat,
        publicClient,
        walletClient: account.walletClient,
      });
    },

    createRegistryPublisher(index: number): RegistryPublisher {
      const account = accounts[index];
      if (account === undefined) {
        throw new Error(`Local chain account index ${String(index)} is out of range`);
      }
      return createRegistryPublisher({
        privateKeyHex: account.privateKeyHex,
        registryAddress: registry.address,
        chain: hardhat,
        publicClient,
        walletClient: account.walletClient,
      });
    },

    createReader() {
      return createBaseSepoliaReader({
        registryAddress: registry.address,
        chain: hardhat,
        publicClient,
      });
    },
  };
}

export function getLocalChainHarness(): Promise<LocalChainHarness> {
  harnessPromise ??= createHarness();
  return harnessPromise;
}
