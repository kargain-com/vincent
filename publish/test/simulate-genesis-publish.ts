import { compile } from '@kargain/vincent-compiler';
import { parseEther } from 'viem';

import type { PublishGenesisReport } from '../src/adapters/types.js';
import {
  preflightGenesisPublish,
  type GenesisPreflightOptions,
} from '../src/preflight-genesis-publish.js';
import { publishGenesis } from '../src/publish-genesis.js';
import { TEST_PRIVATE_KEY, TEST_PUBLISHER } from '../src/constants.js';
import {
  verifyGenesisPublish,
  type VerifyGenesisPublishResult,
} from '../src/verify-genesis-publish.js';
import { loadGenesisMiniClaims } from './helpers.js';
import { createMockChainPublisher, type MockChainPublisher } from './mock-chain-publisher.js';
import { createMockIrysGateway } from './mock-irys-gateway.js';
import { createLiveMockIrysFetchImpl } from './live-mock-irys-fetch.js';
import { createMockUploader } from './mock-uploader.js';

export interface SimulateGenesisMiniOptions {
  preflight?: GenesisPreflightOptions;
  skipPreflight?: boolean;
  chainPublisher?: MockChainPublisher;
}

export interface SimulateGenesisMiniResult {
  report: PublishGenesisReport;
  verification: VerifyGenesisPublishResult;
  uploadCount: number;
  leafUploadCount: number;
  chainCallCount: number;
  gatewayUrl: string;
  graphqlUrl: string;
}

function mockPreflightOptions(): GenesisPreflightOptions {
  return {
    rpcUrl: 'http://mock-base-sepolia',
    irysRpcUrl: 'http://mock-eth-sepolia',
    irysGraphqlUrl: 'https://mock.arweave.devnet.irys.test/graphql',
    getBalance: async () => parseEther('1'),
    getIrysPaymentBalance: async () => parseEther('1'),
    probeIrysUploader: async () => {},
    probeIrysGraphql: async () => {},
  };
}

export function mockPreflightOverrides(
  overrides: Partial<GenesisPreflightOptions> = {},
): GenesisPreflightOptions {
  return { ...mockPreflightOptions(), ...overrides };
}

function countLeafUploads(records: readonly { tags: { name: string }[] }[]): number {
  return records.filter((record) =>
    record.tags.some((tag) => tag.name === 'LeafKey'),
  ).length;
}

/**
 * Offline simulation of the founder CLI genesis-mini path:
 * preflight → compile → upload → anchor → post-publish verification.
 */
export async function simulateGenesisMiniPublish(
  options?: SimulateGenesisMiniOptions,
): Promise<SimulateGenesisMiniResult> {
  const claims = loadGenesisMiniClaims();
  const built = compile(claims, {});
  if (!built.ok) {
    throw new Error(built.error.message);
  }

  const chainPublisher = options?.chainPublisher ?? createMockChainPublisher();
  const preflight = options?.preflight ?? mockPreflightOptions();

  if (options?.skipPreflight !== true) {
    await preflightGenesisPublish({
      privateKeyHex: TEST_PRIVATE_KEY,
      publisher: TEST_PUBLISHER,
      epochCountReader: chainPublisher,
      preflight,
    });
  }

  const uploader = createMockUploader();
  const liveGateway = createLiveMockIrysFetchImpl(uploader, TEST_PUBLISHER, 1);
  const report = await publishGenesis({
    epoch: built.value,
    signerKeyHex: TEST_PRIVATE_KEY,
    uploader,
    chainPublisher,
    preflight,
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
    TEST_PUBLISHER,
    1,
  );

  const verification = await verifyGenesisPublish({
    report,
    chainPublisher,
    gatewayUrl,
    graphqlUrl,
    fixture: 'genesis-mini',
    fetchImpl,
  });

  return {
    report,
    verification,
    uploadCount: uploader.records.length,
    leafUploadCount: countLeafUploads(uploader.records),
    chainCallCount: chainPublisher.calls.length,
    gatewayUrl,
    graphqlUrl,
  };
}
