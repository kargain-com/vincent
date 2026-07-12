import { compile } from '@kargain/vincent-compiler';
import { describe, expect, it } from 'vitest';

import { sha256ContentIdToBytes32, ZERO_BYTES32 } from '../src/adapters/sha256-bytes32.js';
import { publishGenesis } from '../src/publish-genesis.js';
import { createLiveMockIrysFetchImpl } from './live-mock-irys-fetch.js';
import { getLocalChainHarness } from './local-chain-harness.js';
import { createMockUploader } from './mock-uploader.js';
import { loadGenesisMiniClaims } from './helpers.js';
import {
  mockPreflightOverrides,
  simulateGenesisMiniPublish,
} from './simulate-genesis-publish.js';

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

  it('publishes epoch 2 with the prior on-chain merkleRoot', async () => {
    const harness = await getLocalChainHarness();
    const account = harness.getAccount(13);
    const chainPublisher = harness.createPublisher(13);
    const genesis = await simulateGenesisMiniPublish({
      signerKeyHex: account.privateKeyHex,
      chainPublisher,
    });
    const parentRoot = sha256ContentIdToBytes32(genesis.report.manifest.dataset.merkleRoot);

    await chainPublisher.publishEpoch({
      merkleRoot: `0x${'a'.repeat(64)}`,
      jsonlSha256: `0x${'b'.repeat(64)}`,
      manifestHash: `0x${'c'.repeat(64)}`,
      parentRoot,
      manifestUri: 'ar://epoch-2',
    });

    expect(await chainPublisher.readEpochCount(account.address)).toBe(2n);
    expect(await chainPublisher.readLatestEpoch(account.address)).toEqual(
      expect.objectContaining({
        merkleRoot: `0x${'a'.repeat(64)}`,
        parentRoot,
        manifestUri: 'ar://epoch-2',
      }),
    );
  });
});
