import { compile, verifyEpoch } from '@kargain/vincent-compiler';
import { parseEther } from 'viem';
import { describe, expect, it } from 'vitest';

import { publishGenesis, TEST_PRIVATE_KEY, TEST_PUBLISHER } from '../src/index.js';
import { preflightGenesisPublish } from '../src/preflight-genesis-publish.js';
import { verifyGenesisPublish } from '../src/verify-genesis-publish.js';
import { createMockChainPublisher } from './mock-chain-publisher.js';
import { createMockIrysGateway } from './mock-irys-gateway.js';
import { createMockUploader } from './mock-uploader.js';
import { loadGenesisMiniClaims } from './helpers.js';
import { simulateGenesisMiniPublish, mockPreflightOverrides } from './simulate-genesis-publish.js';

describe('genesis publish full offline simulation', () => {
  it('runs preflight, publish, chain anchor, manifest fetch, and fixture VIN decode', async () => {
    const result = await simulateGenesisMiniPublish();

    expect(result.verification.ok).toBe(true);
    expect(result.verification.failures).toEqual([]);
    expect(result.chainCallCount).toBe(1);
    expect(result.leafUploadCount).toBeGreaterThan(0);
    expect(result.uploadCount).toBe(result.leafUploadCount + 2);
    expect(result.report.publisher).toBe(TEST_PUBLISHER);
    expect(result.report.manifest.parent).toBeNull();
    expect(result.report.manifestUri).toMatch(/^ar:\/\//);

    const claims = loadGenesisMiniClaims();
    expect(verifyEpoch(result.report.manifest, claims)).toEqual({ ok: true });
  });

  it('uploads leaves, jsonl, and manifest with expected tags', async () => {
    const uploader = createMockUploader();
    const chainPublisher = createMockChainPublisher();
    const claims = loadGenesisMiniClaims();
    const built = compile(claims, {});
    if (!built.ok) {
      throw new Error(built.error.message);
    }

    await publishGenesis({
      epoch: built.value,
      signerKeyHex: TEST_PRIVATE_KEY,
      uploader,
      chainPublisher,
      preflight: mockPreflightOverrides(),
    });

    const leafUploads = uploader.records.filter((record) =>
      record.tags.some((tag) => tag.name === 'LeafKey'),
    );
    const jsonlUploads = uploader.records.filter((record) =>
      record.tags.some((tag) => tag.name === 'Type' && tag.value === 'jsonl'),
    );
    const manifestUploads = uploader.records.filter((record) =>
      record.tags.some((tag) => tag.name === 'Type' && tag.value === 'manifest'),
    );

    expect(leafUploads.length).toBe(built.value.leaves.size);
    expect(jsonlUploads).toHaveLength(1);
    expect(manifestUploads).toHaveLength(1);

    for (const record of uploader.records) {
      expect(record.tags.some((tag) => tag.name === 'App' && tag.value === 'vincent')).toBe(true);
      expect(record.tags.some((tag) => tag.name === 'Epoch' && tag.value === '1')).toBe(true);
    }
  });

  it('blocks at preflight when publisher already has an epoch', async () => {
    const chainPublisher = createMockChainPublisher();
    await chainPublisher.publishEpoch({
      merkleRoot: `0x${'1'.repeat(64)}`,
      jsonlSha256: `0x${'2'.repeat(64)}`,
      manifestHash: `0x${'3'.repeat(64)}`,
      parentRoot: `0x${'0'.repeat(64)}`,
      manifestUri: 'ar://genesis',
    });

    await expect(
      simulateGenesisMiniPublish({
        chainPublisher,
        preflight: mockPreflightOverrides(),
      }),
    ).rejects.toThrow(/already has 1 on-chain epoch/);
  });

  it('blocks at preflight when Base Sepolia balance is insufficient for gas and Irys', async () => {
    await expect(
      preflightGenesisPublish({
        privateKeyHex: TEST_PRIVATE_KEY,
        publisher: TEST_PUBLISHER,
        epochCountReader: createMockChainPublisher(),
        preflight: mockPreflightOverrides({
          getBalance: async () => 0n,
        }),
      }),
    ).rejects.toThrow(/Insufficient Base Sepolia balance/);
  });

  it('blocks at preflight when Irys GraphQL is unavailable', async () => {
    await expect(
      preflightGenesisPublish({
        privateKeyHex: TEST_PRIVATE_KEY,
        publisher: TEST_PUBLISHER,
        epochCountReader: createMockChainPublisher(),
        preflight: mockPreflightOverrides({
          probeIrysGraphql: async () => {
            throw new Error('HTTP 404');
          },
        }),
      }),
    ).rejects.toThrow(/Irys GraphQL unavailable.*HTTP 404/);
  });

  it('reports verification failures when on-chain state diverges', async () => {
    const uploader = createMockUploader();
    const chainPublisher = createMockChainPublisher();
    const claims = loadGenesisMiniClaims();
    const built = compile(claims, {});
    if (!built.ok) {
      throw new Error(built.error.message);
    }

    const report = await publishGenesis({
      epoch: built.value,
      signerKeyHex: TEST_PRIVATE_KEY,
      uploader,
      chainPublisher,
      preflight: mockPreflightOverrides(),
    });

    const tampered = createMockChainPublisher();
    await tampered.publishEpoch({
      merkleRoot: `0x${'f'.repeat(64)}`,
      jsonlSha256: `0x${'e'.repeat(64)}`,
      manifestHash: `0x${'d'.repeat(64)}`,
      parentRoot: `0x${'0'.repeat(64)}`,
      manifestUri: 'ar://wrong-manifest',
    });

    const { gatewayUrl, graphqlUrl, fetchImpl } = createMockIrysGateway(
      uploader.records,
      TEST_PUBLISHER,
      1,
    );

    const verification = await verifyGenesisPublish({
      report,
      chainPublisher: tampered,
      gatewayUrl,
      graphqlUrl,
      fixture: 'genesis-mini',
      fetchImpl,
    });

    expect(verification.ok).toBe(false);
    expect(verification.failures.length).toBeGreaterThan(0);
    expect(verification.failures.join('\n')).toMatch(/on-chain merkleRoot mismatch/);
  });

  it('uses separate gateway and GraphQL endpoints like production Irys', async () => {
    const result = await simulateGenesisMiniPublish();

    expect(result.gatewayUrl).toBe('https://mock.gateway.irys.test');
    expect(result.graphqlUrl).toBe('https://mock.arweave.devnet.irys.test/graphql');
    expect(result.gatewayUrl).not.toBe(result.graphqlUrl);
  });
});
