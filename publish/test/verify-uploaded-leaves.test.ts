import { compile } from '@kargain/vincent-compiler';
import { describe, expect, it } from 'vitest';

import { publishGenesis, TEST_PRIVATE_KEY, TEST_PUBLISHER } from '../src/index.js';
import { loadGenesisMiniClaims } from './helpers.js';
import { createLiveMockIrysFetchImpl } from './live-mock-irys-fetch.js';
import { createMockChainPublisher } from './mock-chain-publisher.js';
import { createMockUploader } from './mock-uploader.js';
import { mockPreflightOverrides } from './simulate-genesis-publish.js';

describe('verifyUploadedLeaves pre-anchor gate', () => {
  it('blocks on-chain anchor when GraphQL returns no indexed leaves', async () => {
    const uploader = createMockUploader();
    const chainPublisher = createMockChainPublisher();
    const claims = loadGenesisMiniClaims();
    const built = compile(claims, {});
    if (!built.ok) {
      throw new Error(built.error.message);
    }

    const emptyGraphqlFetch: typeof fetch = () =>
      Promise.resolve(
        new Response(JSON.stringify({ data: { transactions: { edges: [] } } }), {
          status: 200,
        }),
      );

    await expect(
      publishGenesis({
        epoch: built.value,
        signerKeyHex: TEST_PRIVATE_KEY,
        uploader,
        chainPublisher,
        preflight: mockPreflightOverrides(),
        leafIndexCheck: {
          gatewayUrl: 'https://mock.gateway.irys.test',
          graphqlUrl: 'https://mock.uploader.irys.test/graphql',
          fetchImpl: emptyGraphqlFetch,
          timeoutMs: 0,
          pollIntervalMs: 0,
          sleep: async () => {},
        },
      }),
    ).rejects.toThrow(/not indexed via GraphQL before anchor deadline/);

    expect(chainPublisher.calls).toHaveLength(0);
  });

  it('anchors only after all leaves are GraphQL-indexed', async () => {
    const uploader = createMockUploader();
    const chainPublisher = createMockChainPublisher();
    const claims = loadGenesisMiniClaims();
    const built = compile(claims, {});
    if (!built.ok) {
      throw new Error(built.error.message);
    }

    const liveGateway = createLiveMockIrysFetchImpl(uploader, TEST_PUBLISHER, 1);

    const report = await publishGenesis({
      epoch: built.value,
      signerKeyHex: TEST_PRIVATE_KEY,
      uploader,
      chainPublisher,
      preflight: mockPreflightOverrides(),
      leafIndexCheck: {
        gatewayUrl: liveGateway.gatewayUrl,
        graphqlUrl: liveGateway.graphqlUrl,
        fetchImpl: liveGateway.fetchImpl,
        pollIntervalMs: 0,
        sleep: async () => {},
      },
    });

    expect(chainPublisher.calls).toHaveLength(1);
    expect(report.manifestUri).toMatch(/^ar:\/\//);
  });
});
