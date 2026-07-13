import type { Chain } from 'viem';
import { baseSepolia } from 'viem/chains';

import { BASE_SEPOLIA_CHAIN_ID, REGISTRY_ADDRESS } from '../constants.js';
import {
  createRegistryPublisher,
  createRegistryReader,
  type RegistryPublisher,
  type RegistryPublisherOptions,
  type RegistryReaderOptions,
} from './registry-publisher.js';

export type BaseSepoliaPublisherOptions = Omit<RegistryPublisherOptions, 'chain'> & {
  chain?: Chain;
};

export type BaseSepoliaReaderOptions = Omit<RegistryReaderOptions, 'chain'> & {
  chain?: Chain;
};

export type BaseSepoliaPublisher = RegistryPublisher;

export type { OnChainEpoch, WaitForLatestEpochOptions } from './registry-publisher.js';

/** VincentAnchorRegistry publisher (Base Sepolia by default). */
export function createBaseSepoliaPublisher(
  options: BaseSepoliaPublisherOptions,
): BaseSepoliaPublisher {
  return createRegistryPublisher({ ...options, chain: options.chain ?? baseSepolia });
}

/** Read-only registry access (Base Sepolia by default). */
export function createBaseSepoliaReader(
  options: BaseSepoliaReaderOptions,
): Pick<BaseSepoliaPublisher, 'readEpochCount' | 'readLatestEpoch' | 'waitForLatestEpoch'> {
  return createRegistryReader({ ...options, chain: options.chain ?? baseSepolia });
}

export { BASE_SEPOLIA_CHAIN_ID, REGISTRY_ADDRESS };
