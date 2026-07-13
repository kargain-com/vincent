import { createArweaveGetLeaf } from '@kargain/vincent/arweave';
import { createDecoder } from '@kargain/vincent/decoder';
import { compile, verifyEpoch } from '@kargain/vincent-compiler';
import { parseEther } from 'viem';
import { describe, expect, it, vi } from 'vitest';

import { sha256ContentIdToBytes32, ZERO_BYTES32 } from '../src/adapters/sha256-bytes32.js';
import { publishEpoch, publishGenesis, TEST_PRIVATE_KEY, TEST_PUBLISHER } from '../src/index.js';
import {
  loadGenesisMiniClaims,
  loadGenesisMiniEpoch2Claims,
  VIN_PLANT,
} from './helpers.js';
import { createMockChainPublisher } from './mock-chain-publisher.js';
import { createMockGateway } from './mock-gateway.js';
import { createMockUploader, uploaderStoreToGatewayItems } from './mock-uploader.js';

describe('publishEpoch offline mock e2e', () => {
  it('uploads genesis epoch 1 with zero parentRoot', async () => {
    const claims = loadGenesisMiniClaims();
    const built = compile(claims, {});
    if (!built.ok) {
      throw new Error(built.error.message);
    }

    const uploader = createMockUploader();
    const chainPublisher = createMockChainPublisher();

    const report = await publishEpoch({
      epoch: built.value,
      signerKeyHex: TEST_PRIVATE_KEY,
      uploader,
      chainPublisher,
    });

    expect(report.manifest.epoch).toBe(1);
    expect(report.manifest.parent).toBeNull();
    expect(chainPublisher.calls[0]?.parentRoot).toBe(ZERO_BYTES32);
  });

  it('uploads epoch 2 with prior merkleRoot as parentRoot', async () => {
    const genesisClaims = loadGenesisMiniClaims();
    const genesisBuilt = compile(genesisClaims, {});
    if (!genesisBuilt.ok) {
      throw new Error(genesisBuilt.error.message);
    }

    const epoch2Claims = loadGenesisMiniEpoch2Claims();
    const epoch2Built = compile(epoch2Claims, {});
    if (!epoch2Built.ok) {
      throw new Error(epoch2Built.error.message);
    }

    const uploader = createMockUploader();
    const chainPublisher = createMockChainPublisher();

    const genesisReport = await publishEpoch({
      epoch: genesisBuilt.value,
      signerKeyHex: TEST_PRIVATE_KEY,
      uploader,
      chainPublisher,
    });

    const epoch2Uploader = createMockUploader();
    const epoch2Report = await publishEpoch({
      epoch: epoch2Built.value,
      signerKeyHex: TEST_PRIVATE_KEY,
      uploader: epoch2Uploader,
      chainPublisher,
    });

    expect(epoch2Report.manifest.epoch).toBe(2);
    expect(epoch2Report.manifest.parent).toBe(genesisReport.manifest.dataset.merkleRoot);
    expect(chainPublisher.calls).toHaveLength(2);
    expect(chainPublisher.calls[1]?.parentRoot).toBe(
      sha256ContentIdToBytes32(genesisReport.manifest.dataset.merkleRoot),
    );

    const gatewayItems = uploaderStoreToGatewayItems(epoch2Uploader.records, TEST_PUBLISHER, 2);
    const { gatewayUrl, fetchImpl } = createMockGateway(gatewayItems);
    const getLeaf = createArweaveGetLeaf({
      gatewayUrl,
      publisher: TEST_PUBLISHER,
      epoch: 2,
      fetchImpl,
    });
    const decoder = createDecoder({
      merkleRoot: epoch2Report.manifest.dataset.merkleRoot,
      getLeaf,
    });
    const plant = await decoder.decode(VIN_PLANT);
    expect(plant.attributes.find((attr) => attr.attribute === 'plant')?.value).toBe('Detroit');
    expect(verifyEpoch(epoch2Report.manifest, epoch2Claims)).toEqual({ ok: true });
  });

  it('requireGenesis aborts before upload when publisher already has epochs', async () => {
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
      parentRoot: ZERO_BYTES32,
      manifestUri: 'ar://genesis',
    });

    const uploader = createMockUploader();
    const uploadSpy = vi.spyOn(uploader, 'upload');

    await expect(
      publishEpoch({
        epoch: built.value,
        signerKeyHex: TEST_PRIVATE_KEY,
        uploader,
        chainPublisher,
        requireGenesis: true,
        preflight: {
          rpcUrl: 'http://localhost:8545',
          getBalance: async () => parseEther('1'),
          probeIrysUploader: async () => {},
        },
      }),
    ).rejects.toThrow(/already has 1 on-chain epoch/);

    expect(uploadSpy).not.toHaveBeenCalled();
  });

  it('resumes leaf uploads when leaves are already indexed', async () => {
    const claims = loadGenesisMiniClaims();
    const built = compile(claims, {});
    if (!built.ok) {
      throw new Error(built.error.message);
    }

    const seedUploader = createMockUploader();
    const sortedLeaves = [...built.value.leaves.entries()].sort(([a], [b]) => a.localeCompare(b));
    for (const [leafKey, entry] of sortedLeaves) {
      await seedUploader.upload(
        new TextEncoder().encode(
          JSON.stringify({ leaf: entry.leaf, proof: entry.proof }),
        ),
        [
          { name: 'App', value: 'vincent' },
          { name: 'Epoch', value: '1' },
          { name: 'LeafKey', value: leafKey },
        ],
      );
    }

    const gatewayItems = uploaderStoreToGatewayItems(seedUploader.records, TEST_PUBLISHER, 1);
    const { gatewayUrl, graphqlUrl, fetchImpl } = createMockGateway(gatewayItems);

    const uploader = createMockUploader();
    const uploadSpy = vi.spyOn(uploader, 'upload');
    const chainPublisher = createMockChainPublisher();

    await publishEpoch({
      epoch: built.value,
      signerKeyHex: TEST_PRIVATE_KEY,
      uploader,
      chainPublisher,
      leafIndexCheck: {
        gatewayUrl,
        graphqlUrl,
        fetchImpl,
        resumeBeforeUpload: true,
      },
    });

    expect(uploadSpy).toHaveBeenCalledTimes(2);
  });

  it('publishGenesis wrapper sets requireGenesis', async () => {
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
      parentRoot: ZERO_BYTES32,
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
      }),
    ).rejects.toThrow(/already has 1 on-chain epoch/);

    expect(uploadSpy).not.toHaveBeenCalled();
  });
});
