import { compile } from '@kargain/vincent-compiler';
import { addressFromPrivateKey, toChecksumAddress } from '@kargain/vincent/protocol';
import { parseEther } from 'viem';

import type {
  ChainPublisher,
  PublishEpochArgs,
  PublishGenesisReport,
} from '../src/adapters/types.js';
import type { EpochCountReader } from '../src/assert-genesis-publisher.js';
import {
  preflightEpochPublish,
  type EpochPreflightOptions,
} from '../src/preflight-genesis-publish.js';
import { publishEpoch } from '../src/publish-epoch.js';
import { TEST_PRIVATE_KEY } from '../src/constants.js';
import {
  verifyGenesisPublish,
  type GenesisPublishChainVerifier,
  type VerifyGenesisPublishResult,
} from '../src/verify-genesis-publish.js';
import { loadGenesisMiniEpoch2Claims } from './helpers.js';
import { createMockChainPublisher } from './mock-chain-publisher.js';
import { createMockIrysGateway } from './mock-irys-gateway.js';
import { createLiveMockIrysFetchImpl } from './live-mock-irys-fetch.js';
import { createMockUploader } from './mock-uploader.js';
import type { EpochChainReader } from '../src/resolve-epoch-parent.js';

export interface SimulateEpoch2MiniOptions {
  preflight?: EpochPreflightOptions;
  skipPreflight?: boolean;
  signerKeyHex?: string;
  chainPublisher?: SimulationChainPublisher;
}

export type SimulationChainPublisher = ChainPublisher &
  EpochCountReader &
  EpochChainReader &
  GenesisPublishChainVerifier & {
    readonly calls?: readonly PublishEpochArgs[];
  };

export interface SimulateEpoch2MiniResult {
  report: PublishGenesisReport;
  verification: VerifyGenesisPublishResult;
  uploadCount: number;
  leafUploadCount: number;
  chainCallCount: number;
  gatewayUrl: string;
  graphqlUrl: string;
}

function mockPreflightOptions(): EpochPreflightOptions {
  return {
    rpcUrl: 'http://mock-base-sepolia',
    irysGraphqlUrl: 'https://mock.arweave.devnet.irys.test/graphql',
    getBalance: async () => parseEther('1'),
    probeIrysUploader: async () => {},
    probeIrysGraphql: async () => {},
  };
}

export function mockEpochPreflightOverrides(
  overrides: Partial<EpochPreflightOptions> = {},
): EpochPreflightOptions {
  return { ...mockPreflightOptions(), ...overrides };
}

function countLeafUploads(records: readonly { tags: { name: string }[] }[]): number {
  return records.filter((record) =>
    record.tags.some((tag) => tag.name === 'LeafKey'),
  ).length;
}

/** Offline simulation of incremental epoch 2 on genesis-mini-epoch2 fixture. */
export async function simulateEpoch2MiniPublish(
  options: SimulateEpoch2MiniOptions,
): Promise<SimulateEpoch2MiniResult> {
  const claims = loadGenesisMiniEpoch2Claims();
  const built = compile(claims, {});
  if (!built.ok) {
    throw new Error(built.error.message);
  }

  const signerKeyHex = options.signerKeyHex ?? TEST_PRIVATE_KEY;
  const publisher = toChecksumAddress(addressFromPrivateKey(signerKeyHex));
  const chainPublisher = options.chainPublisher ?? createMockChainPublisher();
  const preflight = options.preflight ?? mockPreflightOptions();

  if (options.skipPreflight !== true) {
    await preflightEpochPublish({
      privateKeyHex: signerKeyHex as `0x${string}`,
      publisher,
      epochCountReader: chainPublisher,
      readLatestEpoch: chainPublisher.readLatestEpoch.bind(chainPublisher),
      preflight: { ...preflight, targetEpochNumber: 2 },
    });
  }

  const uploader = createMockUploader();
  const liveGateway = createLiveMockIrysFetchImpl(uploader, publisher, 2);
  const report = await publishEpoch({
    epoch: built.value,
    signerKeyHex,
    uploader,
    chainPublisher,
    preflight: { ...preflight, targetEpochNumber: 2 },
    leafIndexCheck: {
      gatewayUrl: liveGateway.gatewayUrl,
      graphqlUrl: liveGateway.graphqlUrl,
      fetchImpl: liveGateway.fetchImpl,
      pollIntervalMs: 0,
      sleep: async () => {},
    },
  });

  const { gatewayUrl, graphqlUrl, fetchImpl } = createMockIrysGateway(
    uploader.records,
    publisher,
    2,
  );

  const verification = await verifyGenesisPublish({
    report,
    chainPublisher,
    gatewayUrl,
    graphqlUrl,
    fixture: 'genesis-mini',
    fetchImpl,
    epochNumber: 2,
  });

  return {
    report,
    verification,
    uploadCount: uploader.records.length,
    leafUploadCount: countLeafUploads(uploader.records),
    chainCallCount:
      chainPublisher.calls?.length ??
      Number(await chainPublisher.readEpochCount(publisher as `0x${string}`)),
    gatewayUrl,
    graphqlUrl,
  };
}
