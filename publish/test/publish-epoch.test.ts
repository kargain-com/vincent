import { createArweaveGetLeaf } from '@kargain/vincent/arweave';
import { createDecoder } from '@kargain/vincent/decoder';
import { compile, verifyEpoch } from '@kargain/vincent-compiler';
import { parseEther } from 'viem';
import { describe, expect, it, vi } from 'vitest';

import { sha256ContentIdToBytes32, ZERO_BYTES32 } from '../src/adapters/sha256-bytes32.js';
import {
  createEmptyCheckpoint,
  loadCheckpoint,
  markLeafIndexVerified,
  markLeafUploaded,
  saveCheckpoint,
} from '../src/publish-checkpoint.js';
import { publishEpoch, publishGenesis, TEST_PRIVATE_KEY, TEST_PUBLISHER } from '../src/index.js';
import {
  loadGenesisMiniClaims,
  loadGenesisMiniEpoch2Claims,
  testCheckpointPath,
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
      checkpointPath: testCheckpointPath(),
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
      checkpointPath: testCheckpointPath(),
    });

    const epoch2Uploader = createMockUploader();
    const epoch2Report = await publishEpoch({
      epoch: epoch2Built.value,
      signerKeyHex: TEST_PRIVATE_KEY,
      uploader: epoch2Uploader,
      chainPublisher,
      checkpointPath: testCheckpointPath(),
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

  it('resumes leaf uploads when checkpoint marks leaves complete', async () => {
    const claims = loadGenesisMiniClaims();
    const built = compile(claims, {});
    if (!built.ok) {
      throw new Error(built.error.message);
    }

    const checkpointPath = testCheckpointPath();
    let checkpoint = createEmptyCheckpoint({
      publisher: TEST_PUBLISHER,
      epochNumber: 1,
      merkleRoot: built.value.merkleRoot,
      jsonlSha256: built.value.jsonlSha256,
    });
    const sortedLeaves = [...built.value.leaves.entries()].sort(([a], [b]) => a.localeCompare(b));
    for (const [leafKey] of sortedLeaves) {
      checkpoint = markLeafUploaded(checkpoint, leafKey, `ar://seed-${leafKey}`);
    }
    saveCheckpoint(checkpointPath, checkpoint);

    const uploader = createMockUploader();
    const uploadSpy = vi.spyOn(uploader, 'upload');
    const chainPublisher = createMockChainPublisher();

    await publishEpoch({
      epoch: built.value,
      signerKeyHex: TEST_PRIVATE_KEY,
      uploader,
      chainPublisher,
      checkpointPath,
    });

    expect(uploadSpy).toHaveBeenCalledTimes(2);
  });

  it('anchor-only skips leaf uploads when checkpoint is complete', async () => {
    const claims = loadGenesisMiniClaims();
    const built = compile(claims, {});
    if (!built.ok) {
      throw new Error(built.error.message);
    }

    const seedUploader = createMockUploader();
    const sortedLeaves = [...built.value.leaves.entries()].sort(([a], [b]) => a.localeCompare(b));
    for (const [leafKey, entry] of sortedLeaves) {
      await seedUploader.upload(
        new TextEncoder().encode(JSON.stringify({ leaf: entry.leaf, proof: entry.proof })),
        [
          { name: 'App', value: 'vincent' },
          { name: 'Epoch', value: '1' },
          { name: 'LeafKey', value: leafKey },
        ],
      );
    }
    const jsonlUpload = await seedUploader.upload(
      new TextEncoder().encode('{}'),
      [
        { name: 'App', value: 'vincent' },
        { name: 'Epoch', value: '1' },
        { name: 'Type', value: 'jsonl' },
      ],
    );
    const manifestUpload = await seedUploader.upload(
      new TextEncoder().encode('{}'),
      [
        { name: 'App', value: 'vincent' },
        { name: 'Epoch', value: '1' },
        { name: 'Type', value: 'manifest' },
      ],
    );

    const checkpointPath = testCheckpointPath();
    let checkpoint = createEmptyCheckpoint({
      publisher: TEST_PUBLISHER,
      epochNumber: 1,
      merkleRoot: built.value.merkleRoot,
      jsonlSha256: built.value.jsonlSha256,
    });
    for (const [leafKey] of sortedLeaves) {
      checkpoint = markLeafUploaded(checkpoint, leafKey);
      checkpoint = markLeafIndexVerified(checkpoint, leafKey);
    }
    checkpoint = {
      ...checkpoint,
      jsonlUri: jsonlUpload.uri,
      manifestUri: manifestUpload.uri,
    };
    saveCheckpoint(checkpointPath, checkpoint);

    const gatewayItems = uploaderStoreToGatewayItems(seedUploader.records, TEST_PUBLISHER, 1);
    const { gatewayUrl, graphqlUrl, fetchImpl } = createMockGateway(gatewayItems);

    const uploader = createMockUploader();
    const uploadSpy = vi.spyOn(uploader, 'upload');
    const chainPublisher = createMockChainPublisher();

    const report = await publishEpoch({
      epoch: built.value,
      signerKeyHex: TEST_PRIVATE_KEY,
      uploader,
      chainPublisher,
      checkpointPath,
      phases: {
        uploadLeaves: false,
        uploadArtifacts: false,
      },
      leafIndexCheck: {
        gatewayUrl,
        graphqlUrl,
        fetchImpl,
        pollIntervalMs: 0,
        sleep: async () => {},
      },
    });

    expect(uploadSpy).not.toHaveBeenCalled();
    expect(report.txHash).toMatch(/^0x[0-9a-f]{64}$/);
    expect(chainPublisher.calls).toHaveLength(1);
  });

  it('retry-failed uploads only failedLeafKeys and clears them', async () => {
    const claims = loadGenesisMiniClaims();
    const built = compile(claims, {});
    if (!built.ok) {
      throw new Error(built.error.message);
    }

    const sortedLeaves = [...built.value.leaves.entries()].sort(([a], [b]) => a.localeCompare(b));
    const failedKeys = sortedLeaves.slice(0, 2).map(([leafKey]) => leafKey);

    const checkpointPath = testCheckpointPath();
    let checkpoint = createEmptyCheckpoint({
      publisher: TEST_PUBLISHER,
      epochNumber: 1,
      merkleRoot: built.value.merkleRoot,
      jsonlSha256: built.value.jsonlSha256,
    });
    for (const [leafKey] of sortedLeaves) {
      checkpoint = markLeafUploaded(checkpoint, leafKey);
    }
    checkpoint = {
      ...checkpoint,
      failedLeafKeys: [...failedKeys],
      jsonlUri: 'ar://jsonl',
      manifestUri: 'ar://manifest',
    };
    saveCheckpoint(checkpointPath, checkpoint);

    const uploader = createMockUploader();
    const chainPublisher = createMockChainPublisher();

    await publishEpoch({
      epoch: built.value,
      signerKeyHex: TEST_PRIVATE_KEY,
      uploader,
      chainPublisher,
      checkpointPath,
      uploadScope: 'failed-only',
      phases: {
        uploadArtifacts: false,
        indexCheck: false,
        anchor: false,
      },
    });

    const uploadedLeafKeys = uploader.records
      .map((record) => record.tags.find((tag) => tag.name === 'LeafKey')?.value)
      .filter((value): value is string => value !== undefined);
    expect(uploadedLeafKeys.sort()).toEqual([...failedKeys].sort());
    expect(chainPublisher.calls).toHaveLength(0);

    const saved = loadCheckpoint(checkpointPath);
    expect(saved?.failedLeafKeys).toEqual([]);
    for (const leafKey of failedKeys) {
      expect(saved?.leafUris[leafKey]).toMatch(/^ar:\/\//);
    }
  });

  it('blocks anchor and records failedLeafKeys when index-check fails', async () => {
    const claims = loadGenesisMiniClaims();
    const built = compile(claims, {});
    if (!built.ok) {
      throw new Error(built.error.message);
    }

    const uploader = createMockUploader();
    const chainPublisher = createMockChainPublisher();
    const checkpointPath = testCheckpointPath();

    const emptyGraphqlFetch: typeof fetch = () =>
      Promise.resolve(
        new Response(JSON.stringify({ data: { transactions: { edges: [] } } }), {
          status: 200,
        }),
      );

    await expect(
      publishEpoch({
        epoch: built.value,
        signerKeyHex: TEST_PRIVATE_KEY,
        uploader,
        chainPublisher,
        checkpointPath,
        leafIndexCheck: {
          gatewayUrl: 'https://mock.gateway.irys.test',
          graphqlUrl: 'https://mock.uploader.irys.test/graphql',
          fetchImpl: emptyGraphqlFetch,
          timeoutMs: 0,
          pollIntervalMs: 0,
          sleep: async () => {},
        },
      }),
    ).rejects.toThrow(/Index-check failed for \d+ of \d+ leaves.*--retry-failed/s);

    expect(chainPublisher.calls).toHaveLength(0);

    const saved = loadCheckpoint(checkpointPath);
    expect(saved?.failedLeafKeys.sort()).toEqual(
      [...built.value.leaves.keys()].sort(),
    );
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

  it('reports missing leafUris on checkpoint load and emits a backfill hint', async () => {
    const claims = loadGenesisMiniClaims();
    const built = compile(claims, {});
    if (!built.ok) {
      throw new Error(built.error.message);
    }

    const checkpointPath = testCheckpointPath();
    let checkpoint = createEmptyCheckpoint({
      publisher: TEST_PUBLISHER,
      epochNumber: 1,
      merkleRoot: built.value.merkleRoot,
      jsonlSha256: built.value.jsonlSha256,
    });
    for (const leafKey of built.value.leaves.keys()) {
      checkpoint = markLeafIndexVerified(checkpoint, leafKey);
    }
    saveCheckpoint(checkpointPath, checkpoint);

    const hints: string[] = [];
    let summary:
      | {
          needsLeafUriBackfill: boolean;
          indexVerifiedLeaves: number;
        }
      | undefined;

    const uploader = createMockUploader();
    const chainPublisher = createMockChainPublisher();

    await publishEpoch({
      epoch: built.value,
      signerKeyHex: TEST_PRIVATE_KEY,
      uploader,
      chainPublisher,
      checkpointPath,
      phases: {
        uploadLeaves: false,
        uploadArtifacts: false,
        indexCheck: false,
        anchor: false,
      },
      onCheckpointLoaded: (value) => {
        summary = value;
      },
      onHint: (message) => {
        hints.push(message);
      },
    });

    expect(summary?.needsLeafUriBackfill).toBe(true);
    expect(summary?.indexVerifiedLeaves).toBe(built.value.leaves.size);
    expect(hints).toHaveLength(1);
    expect(hints[0]).toContain('backfill:leaf-uris');
  });
});
