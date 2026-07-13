import { compile } from '@kargain/vincent-compiler';
import { describe, expect, it } from 'vitest';

import { sha256ContentIdToBytes32, ZERO_BYTES32 } from '../src/adapters/sha256-bytes32.js';
import { publishEpoch } from '../src/publish-epoch.js';
import { createLiveMockIrysFetchImpl } from './live-mock-irys-fetch.js';
import { getLocalChainHarness } from './local-chain-harness.js';
import { createMockUploader } from './mock-uploader.js';
import { loadGenesisMiniClaims, loadGenesisMiniEpoch2Claims } from './helpers.js';
import { testCheckpointPath } from './helpers.js';
import {
  mockPreflightOverrides,
  simulateGenesisMiniPublish,
} from './simulate-genesis-publish.js';
import { mockEpochPreflightOverrides, simulateEpoch2MiniPublish } from './simulate-epoch-publish.js';
import { publishGenesis } from '../src/publish-genesis.js';

function compileGenesisMini() {
  const built = compile(loadGenesisMiniClaims(), {});
  if (!built.ok) {
    throw new Error(built.error.message);
  }
  return built.value;
}

describe('genesis pipeline against real local VincentAnchorRegistry', () => {
  it('compiles, uploads, anchors, reads on-chain, and decodes fixture VINs', async () => {
    const harness = await getLocalChainHarness();
    const account = harness.getAccount(10);
    const result = await simulateGenesisMiniPublish({
      signerKeyHex: account.privateKeyHex,
      chainPublisher: harness.createPublisher(10),
    });

    expect(result.verification).toEqual({ ok: true, failures: [] });
    expect(result.chainCallCount).toBe(1);
    expect(result.leafUploadCount).toBeGreaterThan(0);
  });

  it('aborts a same-account re-publish before uploading anything', async () => {
    const harness = await getLocalChainHarness();
    const account = harness.getAccount(11);
    const chainPublisher = harness.createPublisher(11);
    const epoch = compileGenesisMini();

    await publishGenesis({
      epoch,
      signerKeyHex: account.privateKeyHex,
      uploader: createMockUploader(),
      chainPublisher,
      checkpointPath: testCheckpointPath(),
    });

    const secondUploader = createMockUploader();
    await expect(
      publishGenesis({
        epoch,
        signerKeyHex: account.privateKeyHex,
        uploader: secondUploader,
        chainPublisher,
        preflight: mockPreflightOverrides(),
      }),
    ).rejects.toThrow(/already has 1 on-chain epoch/);

    expect(secondUploader.records).toHaveLength(0);
    await expect(
      chainPublisher.publishEpoch({
        merkleRoot: `0x${'7'.repeat(64)}`,
        jsonlSha256: `0x${'8'.repeat(64)}`,
        manifestHash: `0x${'9'.repeat(64)}`,
        parentRoot: ZERO_BYTES32,
        manifestUri: 'ar://second-genesis',
      }),
    ).rejects.toThrow(/parentRoot mismatch/);
  });

  it('rejects tampered uploaded leaf bytes before anchoring', async () => {
    const harness = await getLocalChainHarness();
    const account = harness.getAccount(12);
    const chainPublisher = harness.createPublisher(12);
    const epoch = compileGenesisMini();
    const uploader = createMockUploader();
    const gateway = createLiveMockIrysFetchImpl(uploader, account.address, 1);

    const tamperedFetch: typeof fetch = async (input, init) => {
      const response = await gateway.fetchImpl(input, init);
      const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
      if (!response.ok || !url.startsWith(`${gateway.gatewayUrl}/`)) {
        return response;
      }

      const payload = (await response.json()) as {
        leaf: unknown;
        proof: unknown;
      };
      if (typeof payload.leaf !== 'string') {
        throw new Error('Expected uploaded leaf to be a string');
      }
      return new Response(
        JSON.stringify({ ...payload, leaf: `${payload.leaf} ` }),
        { status: response.status, headers: response.headers },
      );
    };

    await expect(
      publishGenesis({
        epoch,
        signerKeyHex: account.privateKeyHex,
        uploader,
        chainPublisher,
        checkpointPath: testCheckpointPath(),
        preflight: mockPreflightOverrides(),
        leafIndexCheck: {
          gatewayUrl: gateway.gatewayUrl,
          graphqlUrl: gateway.graphqlUrl,
          fetchImpl: tamperedFetch,
          pollIntervalMs: 0,
          sleep: async () => {},
        },
      }),
    ).rejects.toThrow(/Merkle proof invalid/);

    expect(await chainPublisher.readEpochCount(account.address)).toBe(0n);
  });

  it('publishes epoch 2 via full pipeline with prior on-chain merkleRoot', async () => {
    const harness = await getLocalChainHarness();
    const account = harness.getAccount(13);
    const chainPublisher = harness.createPublisher(13);
    const genesis = await simulateGenesisMiniPublish({
      signerKeyHex: account.privateKeyHex,
      chainPublisher,
    });

    const epoch2 = await simulateEpoch2MiniPublish({
      signerKeyHex: account.privateKeyHex,
      chainPublisher,
      preflight: mockEpochPreflightOverrides(),
    });

    const parentRoot = sha256ContentIdToBytes32(genesis.report.manifest.dataset.merkleRoot);

    expect(epoch2.verification).toEqual({ ok: true, failures: [] });
    expect(epoch2.report.manifest.epoch).toBe(2);
    expect(epoch2.report.manifest.parent).toBe(genesis.report.manifest.dataset.merkleRoot);
    expect(await chainPublisher.readEpochCount(account.address)).toBe(2n);
    expect(await chainPublisher.readLatestEpoch(account.address)).toEqual(
      expect.objectContaining({
        parentRoot,
        manifestUri: epoch2.report.manifestUri,
      }),
    );
  });

  it('requireGenesis aborts before upload when publisher already has an epoch', async () => {
    const harness = await getLocalChainHarness();
    const account = harness.getAccount(14);
    const chainPublisher = harness.createPublisher(14);
    const epoch = compile(loadGenesisMiniClaims(), {});
    if (!epoch.ok) {
      throw new Error(epoch.error.message);
    }

    await publishGenesis({
      epoch: epoch.value,
      signerKeyHex: account.privateKeyHex,
      uploader: createMockUploader(),
      chainPublisher,
      checkpointPath: testCheckpointPath(),
    });

    const epoch2Built = compile(loadGenesisMiniEpoch2Claims(), {});
    if (!epoch2Built.ok) {
      throw new Error(epoch2Built.error.message);
    }

    const secondUploader = createMockUploader();
    await expect(
      publishEpoch({
        checkpointPath: testCheckpointPath(),
        epoch: epoch2Built.value,
        signerKeyHex: account.privateKeyHex,
        uploader: secondUploader,
        chainPublisher,
        requireGenesis: true,
        preflight: mockPreflightOverrides(),
      }),
    ).rejects.toThrow(/already has 1 on-chain epoch/);

    expect(secondUploader.records).toHaveLength(0);
  });
});
