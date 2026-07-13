import { compile } from '@kargain/vincent-compiler';
import { buildLeafUriSidecar } from '@kargain/vincent/arweave';
import { addressFromPrivateKey, toChecksumAddress } from '@kargain/vincent/protocol';
import { describe, expect, it } from 'vitest';

import { TEST_PRIVATE_KEY } from '../src/constants.js';
import { publishGenesis } from '../src/publish-genesis.js';
import { verifyGenesisPublish } from '../src/verify-genesis-publish.js';
import { loadGenesisMiniClaims } from './helpers.js';
import { testCheckpointPath } from './helpers.js';
import { createMockChainPublisher } from './mock-chain-publisher.js';
import { createMockGateway } from './mock-gateway.js';
import { MOCK_IRYS_GATEWAY_URL, MOCK_IRYS_GRAPHQL_URL } from './mock-irys-gateway.js';
import { createMockUploader } from './mock-uploader.js';
import { uploaderStoreToGatewayItems } from './mock-uploader.js';
import { mockPreflightOverrides } from './simulate-genesis-publish.js';

describe('verifyGenesisPublish', () => {
  it('decodes fixture VINs via checkpoint leafUris when per-LeafKey GraphQL is empty', async () => {
    const claims = loadGenesisMiniClaims();
    const built = compile(claims, {});
    if (!built.ok) {
      throw new Error(built.error.message);
    }

    const signerKeyHex = TEST_PRIVATE_KEY;
    const publisher = toChecksumAddress(addressFromPrivateKey(signerKeyHex));
    const chainPublisher = createMockChainPublisher();
    const uploader = createMockUploader();

    const report = await publishGenesis({
      epoch: built.value,
      signerKeyHex,
      uploader,
      chainPublisher,
      checkpointPath: testCheckpointPath(),
      preflight: mockPreflightOverrides(),
    });

    const leafUris: Record<string, string> = {};
    for (const record of uploader.records) {
      const leafKey = record.tags.find((tag) => tag.name === 'LeafKey')?.value;
      if (leafKey !== undefined) {
        leafUris[leafKey] = `ar://${record.id}`;
      }
    }

    const leafItems = uploaderStoreToGatewayItems(uploader.records, publisher, 1);
    const staticBodies: Record<string, string> = {};
    const staticBinaryBodies: Record<string, Uint8Array> = {};
    for (const record of uploader.records) {
      const typeTag = record.tags.find((tag) => tag.name === 'Type');
      if (typeTag?.value === 'jsonl') {
        staticBinaryBodies[record.id] = record.data;
      } else {
        staticBodies[record.id] = new TextDecoder().decode(record.data);
      }
    }

    const { gatewayUrl, graphqlUrl, fetchImpl } = createMockGateway([], {
      gatewayUrl: MOCK_IRYS_GATEWAY_URL,
      graphqlUrl: MOCK_IRYS_GRAPHQL_URL,
      staticBodies,
      staticBinaryBodies,
    });

    const verification = await verifyGenesisPublish({
      report,
      chainPublisher,
      gatewayUrl,
      graphqlUrl,
      fixture: 'genesis-mini',
      fetchImpl,
      leafUris,
    });

    expect(verification).toEqual({ ok: true, failures: [] });
    expect(Object.keys(leafUris).length).toBeGreaterThan(0);
    expect(leafItems.length).toBeGreaterThan(0);
  });

  it('decodes fixture VINs via leafUriSidecarUri when explicit leafUris omitted', async () => {
    const claims = loadGenesisMiniClaims();
    const built = compile(claims, {});
    if (!built.ok) {
      throw new Error(built.error.message);
    }

    const signerKeyHex = TEST_PRIVATE_KEY;
    const publisher = toChecksumAddress(addressFromPrivateKey(signerKeyHex));
    const chainPublisher = createMockChainPublisher();
    const uploader = createMockUploader();

    const report = await publishGenesis({
      epoch: built.value,
      signerKeyHex,
      uploader,
      chainPublisher,
      checkpointPath: testCheckpointPath(),
      preflight: mockPreflightOverrides(),
    });

    const leafUris: Record<string, string> = {};
    for (const record of uploader.records) {
      const leafKey = record.tags.find((tag) => tag.name === 'LeafKey')?.value;
      if (leafKey !== undefined) {
        leafUris[leafKey] = `ar://${record.id}`;
      }
    }

    const sidecar = buildLeafUriSidecar(
      {
        publisher: publisher.toLowerCase(),
        epoch: report.manifest.epoch,
        merkleRoot: report.manifest.dataset.merkleRoot,
        jsonlSha256: report.manifest.dataset.jsonlSha256,
      },
      leafUris,
    );

    const staticBodies: Record<string, string> = {
      'tx-sidecar': JSON.stringify(sidecar),
    };
    const staticBinaryBodies: Record<string, Uint8Array> = {};
    for (const record of uploader.records) {
      const typeTag = record.tags.find((tag) => tag.name === 'Type');
      if (typeTag?.value === 'jsonl') {
        staticBinaryBodies[record.id] = record.data;
      } else {
        staticBodies[record.id] = new TextDecoder().decode(record.data);
      }
    }

    const { gatewayUrl, graphqlUrl, fetchImpl } = createMockGateway([], {
      gatewayUrl: MOCK_IRYS_GATEWAY_URL,
      graphqlUrl: MOCK_IRYS_GRAPHQL_URL,
      staticBodies,
      staticBinaryBodies,
    });

    const verification = await verifyGenesisPublish({
      report,
      chainPublisher,
      gatewayUrl,
      graphqlUrl,
      fixture: 'genesis-mini',
      fetchImpl,
      leafUriSidecarUri: 'ar://tx-sidecar',
      discoverLeafUriSidecar: false,
    });

    expect(verification).toEqual({ ok: true, failures: [] });
  });
});
