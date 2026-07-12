import { createArweaveGetLeaf } from '@kargain/vincent/arweave';
import { createDecoder } from '@kargain/vincent/decoder';
import { compile, verifyEpoch } from '@kargain/vincent-compiler';
import { parseEther } from 'viem';
import { describe, expect, it, vi } from 'vitest';

import { sha256ContentIdToBytes32, ZERO_BYTES32 } from '../src/adapters/sha256-bytes32.js';
import { publishGenesis, TEST_PRIVATE_KEY, TEST_PUBLISHER } from '../src/index.js';
import { createMockChainPublisher } from './mock-chain-publisher.js';
import { createMockGateway } from './mock-gateway.js';
import { createMockUploader, uploaderStoreToGatewayItems } from './mock-uploader.js';
import {
  loadGenesisMiniClaims,
  VIN_2011,
  VIN_2014,
  VIN_BODY,
  VIN_FUEL,
  VIN_PLANT,
} from './helpers.js';

describe('publishGenesis offline mock e2e', () => {
  it('uploads, anchors, decodes via tag getLeaf, and verifyEpoch passes', async () => {
    const claims = loadGenesisMiniClaims();
    const built = compile(claims, {});
    if (!built.ok) {
      throw new Error(built.error.message);
    }

    const uploader = createMockUploader();
    const chainPublisher = createMockChainPublisher();

    const report = await publishGenesis({
      epoch: built.value,
      signerKeyHex: TEST_PRIVATE_KEY,
      uploader,
      chainPublisher,
    });

    expect(report.publisher).toBe(TEST_PUBLISHER);
    expect(report.leafCount).toBe(built.value.leaves.size);
    expect(report.jsonlUri).toMatch(/^ar:\/\/mock-/);
    expect(report.manifestUri).toMatch(/^ar:\/\/mock-/);
    expect(report.manifestHash).toMatch(/^sha256:[0-9a-f]{64}$/);
    expect(report.txHash).toMatch(/^0x[0-9a-f]{64}$/);

    expect(chainPublisher.calls).toHaveLength(1);
    const chainCall = chainPublisher.calls[0];
    expect(chainCall.parentRoot).toBe(ZERO_BYTES32);
    expect(chainCall.merkleRoot).toBe(sha256ContentIdToBytes32(built.value.merkleRoot));
    expect(chainCall.jsonlSha256).toBe(sha256ContentIdToBytes32(built.value.jsonlSha256));
    expect(chainCall.manifestHash).toBe(sha256ContentIdToBytes32(report.manifestHash));
    expect(chainCall.manifestUri).toBe(report.manifestUri);

    expect(verifyEpoch(report.manifest, claims)).toEqual({ ok: true });

    const gatewayItems = uploaderStoreToGatewayItems(uploader.records, TEST_PUBLISHER, 1);
    expect(gatewayItems.length).toBeGreaterThan(0);

    const { gatewayUrl, fetchImpl } = createMockGateway(gatewayItems);
    const getLeaf = createArweaveGetLeaf({
      gatewayUrl,
      publisher: TEST_PUBLISHER,
      epoch: 1,
      fetchImpl,
    });

    const decoder = createDecoder({
      merkleRoot: report.manifest.dataset.merkleRoot,
      getLeaf,
    });

    const result2011 = await decoder.decode(VIN_2011);
    const result2014 = await decoder.decode(VIN_2014);

    expect(result2011.year.value).toBe(2011);
    expect(result2014.year.value).toBe(2014);
    expect(result2011.attributes.find((attr) => attr.attribute === 'model')?.value).toBe('Fusion');
    expect(result2014.attributes.find((attr) => attr.attribute === 'model')?.value).toBe('Fusion');

    const body = await decoder.decode(VIN_BODY);
    expect(body.attributes.find((attr) => attr.attribute === 'bodyType')).toEqual(
      expect.objectContaining({ attribute: 'bodyType', value: 'Sedan', ambiguous: false }),
    );

    const fuel = await decoder.decode(VIN_FUEL);
    expect(fuel.attributes.find((attr) => attr.attribute === 'fuelType')).toEqual(
      expect.objectContaining({ attribute: 'fuelType', value: 'Gasoline', ambiguous: false }),
    );

    const plant = await decoder.decode(VIN_PLANT);
    expect(plant.attributes.find((attr) => attr.attribute === 'plant')).toEqual(
      expect.objectContaining({ attribute: 'plant', value: 'Chicago', ambiguous: false }),
    );

    expect(JSON.stringify(result2011.attributes)).not.toContain('Fusion-OLD');
  });

  it('rejects a second genesis publish for the same publisher', async () => {
    const claims = loadGenesisMiniClaims();
    const built = compile(claims, {});
    if (!built.ok) {
      throw new Error(built.error.message);
    }

    const uploader = createMockUploader();
    const chainPublisher = createMockChainPublisher();

    await publishGenesis({
      epoch: built.value,
      signerKeyHex: TEST_PRIVATE_KEY,
      uploader,
      chainPublisher,
    });

    const secondUploader = createMockUploader();
    await expect(
      publishGenesis({
        epoch: built.value,
        signerKeyHex: TEST_PRIVATE_KEY,
        uploader: secondUploader,
        chainPublisher,
      }),
    ).rejects.toThrow(/already has 1 on-chain epoch/);

    expect(chainPublisher.calls).toHaveLength(1);
    expect(secondUploader.records).toHaveLength(0);
  });

  it('preflight aborts before any uploader.upload when publisher already has epochs', async () => {
    const claims = loadGenesisMiniClaims();
    const built = compile(claims, {});
    if (!built.ok) {
      throw new Error(built.error.message);
    }

    const chainPublisher = createMockChainPublisher();
    await chainPublisher.publishEpoch({
      merkleRoot: `0x${'1'.repeat(64)}`,
      jsonlSha256: `0x${'2'.repeat(64)}`,
      manifestHash: `0x${'3'.repeat(64)}`,
      parentRoot: `0x${'0'.repeat(64)}`,
      manifestUri: 'ar://genesis',
    });

    const uploader = createMockUploader();
    const uploadSpy = vi.spyOn(uploader, 'upload');

    await expect(
      publishGenesis({
        epoch: built.value,
        signerKeyHex: TEST_PRIVATE_KEY,
        uploader,
        chainPublisher,
        preflight: {
          rpcUrl: 'http://localhost:8545',
          getBalance: async () => parseEther('1'),
          probeIrysUploader: async () => {},
        },
      }),
    ).rejects.toThrow(/already has 1 on-chain epoch/);

    expect(uploadSpy).not.toHaveBeenCalled();
  });
});
