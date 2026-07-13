import { compile } from '@kargain/vincent-compiler';
import { describe, expect, it } from 'vitest';

import { publishGenesis, TEST_PRIVATE_KEY, TEST_PUBLISHER } from '../src/index.js';
import {
  createEmptyCheckpoint,
  markLeafIndexVerified,
  setLeafUri,
} from '../src/publish-checkpoint.js';
import { verifyUploadedLeaves } from '../src/verify-uploaded-leaves.js';
import { loadGenesisMiniClaims, testCheckpointPath } from './helpers.js';
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
        checkpointPath: testCheckpointPath(),
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
      checkpointPath: testCheckpointPath(),
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

describe('verifyUploadedLeaves re-upload', () => {
  it('re-uploads a missing leaf and retries index verification', async () => {
    const built = compile(loadGenesisMiniClaims(), {});
    if (!built.ok) {
      throw new Error(built.error.message);
    }

    const uploader = createMockUploader();
    const sortedLeaves = [...built.value.leaves.entries()].sort(([a], [b]) => a.localeCompare(b));
    for (const [leafKey, entry] of sortedLeaves.slice(1)) {
      await uploader.upload(
        new TextEncoder().encode(JSON.stringify({ leaf: entry.leaf, proof: entry.proof })),
        [
          { name: 'App', value: 'vincent' },
          { name: 'Epoch', value: '1' },
          { name: 'LeafKey', value: leafKey },
        ],
      );
    }

    const liveGateway = createLiveMockIrysFetchImpl(uploader, TEST_PUBLISHER, 1);

    await verifyUploadedLeaves({
      epoch: built.value,
      publisher: TEST_PUBLISHER,
      epochNumber: 1,
      gatewayUrl: liveGateway.gatewayUrl,
      graphqlUrl: liveGateway.graphqlUrl,
      fetchImpl: liveGateway.fetchImpl,
      timeoutMs: 50,
      pollIntervalMs: 0,
      sleep: async () => {},
      concurrency: 1,
      reuploadOnFailure: true,
      uploader,
    });

    const missingLeaf = sortedLeaves[0]?.[0];
    expect(
      uploader.records.some((record) =>
        record.tags.some((tag) => tag.name === 'LeafKey' && tag.value === missingLeaf),
      ),
    ).toBe(true);
  });

  it('skips leaves already marked in the checkpoint', async () => {
    const built = compile(loadGenesisMiniClaims(), {});
    if (!built.ok) {
      throw new Error(built.error.message);
    }

    const uploader = createMockUploader();
    const sortedLeaves = [...built.value.leaves.entries()].sort(([a], [b]) => a.localeCompare(b));
    for (const [leafKey, entry] of sortedLeaves) {
      await uploader.upload(
        new TextEncoder().encode(JSON.stringify({ leaf: entry.leaf, proof: entry.proof })),
        [
          { name: 'App', value: 'vincent' },
          { name: 'Epoch', value: '1' },
          { name: 'LeafKey', value: leafKey },
        ],
      );
    }

    const liveGateway = createLiveMockIrysFetchImpl(uploader, TEST_PUBLISHER, 1);
    const verified = sortedLeaves.slice(0, 2).map(([leafKey]) => leafKey);
    const progress: number[] = [];

    let checkpoint = createEmptyCheckpoint({
      publisher: TEST_PUBLISHER,
      epochNumber: 1,
      merkleRoot: built.value.merkleRoot,
      jsonlSha256: built.value.jsonlSha256,
    });
    for (const leafKey of verified) {
      checkpoint = markLeafIndexVerified(checkpoint, leafKey);
    }

    await verifyUploadedLeaves({
      epoch: built.value,
      publisher: TEST_PUBLISHER,
      epochNumber: 1,
      gatewayUrl: liveGateway.gatewayUrl,
      graphqlUrl: liveGateway.graphqlUrl,
      fetchImpl: liveGateway.fetchImpl,
      pollIntervalMs: 0,
      sleep: async () => {},
      concurrency: 2,
      checkpoint,
      onLeafVerified: (completed) => {
        progress.push(completed);
      },
    });

    expect(progress[0]).toBe(2);
    expect(progress.at(-1)).toBe(sortedLeaves.length);
  });
});

describe('verifyUploadedLeaves non-fail-fast', () => {
  it('collects failures for all leaves and keeps verifying the rest', async () => {
    const built = compile(loadGenesisMiniClaims(), {});
    if (!built.ok) {
      throw new Error(built.error.message);
    }

    const uploader = createMockUploader();
    const sortedLeaves = [...built.value.leaves.entries()].sort(([a], [b]) => a.localeCompare(b));
    // Upload every leaf except the first two, which will fail the index check.
    const missingKeys = sortedLeaves.slice(0, 2).map(([leafKey]) => leafKey);
    for (const [leafKey, entry] of sortedLeaves.slice(2)) {
      await uploader.upload(
        new TextEncoder().encode(JSON.stringify({ leaf: entry.leaf, proof: entry.proof })),
        [
          { name: 'App', value: 'vincent' },
          { name: 'Epoch', value: '1' },
          { name: 'LeafKey', value: leafKey },
        ],
      );
    }

    const liveGateway = createLiveMockIrysFetchImpl(uploader, TEST_PUBLISHER, 1);
    const failedCallbacks: string[] = [];

    const result = await verifyUploadedLeaves({
      epoch: built.value,
      publisher: TEST_PUBLISHER,
      epochNumber: 1,
      gatewayUrl: liveGateway.gatewayUrl,
      graphqlUrl: liveGateway.graphqlUrl,
      fetchImpl: liveGateway.fetchImpl,
      timeoutMs: 0,
      pollIntervalMs: 0,
      sleep: async () => {},
      concurrency: 2,
      onLeafFailed: (leafKey) => {
        failedCallbacks.push(leafKey);
      },
    });

    expect(result.failed.map((entry) => entry.leafKey).sort()).toEqual([...missingKeys].sort());
    expect(result.verified).toBe(sortedLeaves.length - missingKeys.length);
    expect(failedCallbacks.sort()).toEqual([...missingKeys].sort());
    for (const entry of result.failed) {
      expect(entry.error).toMatch(/not indexed via GraphQL/);
    }
  });

  it('marks failed leaves in the checkpoint', async () => {
    const built = compile(loadGenesisMiniClaims(), {});
    if (!built.ok) {
      throw new Error(built.error.message);
    }

    const emptyGraphqlFetch: typeof fetch = () =>
      Promise.resolve(
        new Response(JSON.stringify({ data: { transactions: { edges: [] } } }), { status: 200 }),
      );

    const checkpointPath = testCheckpointPath();
    const result = await verifyUploadedLeaves({
      epoch: built.value,
      publisher: TEST_PUBLISHER,
      epochNumber: 1,
      gatewayUrl: 'https://mock.gateway.irys.test',
      graphqlUrl: 'https://mock.uploader.irys.test/graphql',
      fetchImpl: emptyGraphqlFetch,
      timeoutMs: 0,
      pollIntervalMs: 0,
      sleep: async () => {},
      checkpoint: createEmptyCheckpoint({
        publisher: TEST_PUBLISHER,
        epochNumber: 1,
        merkleRoot: built.value.merkleRoot,
        jsonlSha256: built.value.jsonlSha256,
      }),
      checkpointPath,
    });

    expect(result.failed).toHaveLength(built.value.leaves.size);
    expect(result.checkpoint?.failedLeafKeys.sort()).toEqual(
      [...built.value.leaves.keys()].sort(),
    );
  });
});

describe('verifyUploadedLeaves gateway fallback', () => {
  function emptyGraphqlButLiveGateway(liveFetch: typeof fetch, graphqlUrl: string): typeof fetch {
    return (input, init) => {
      const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
      if (url === graphqlUrl && init?.method === 'POST') {
        return Promise.resolve(
          new Response(JSON.stringify({ data: { transactions: { edges: [] } } }), { status: 200 }),
        );
      }
      return liveFetch(input, init);
    };
  }

  it('accepts a re-uploaded leaf via the gateway when GraphQL stays empty', async () => {
    const built = compile(loadGenesisMiniClaims(), {});
    if (!built.ok) {
      throw new Error(built.error.message);
    }

    const uploader = createMockUploader();
    const liveGateway = createLiveMockIrysFetchImpl(uploader, TEST_PUBLISHER, 1);
    const fetchImpl = emptyGraphqlButLiveGateway(liveGateway.fetchImpl, liveGateway.graphqlUrl);

    const checkpointPath = testCheckpointPath();
    const result = await verifyUploadedLeaves({
      epoch: built.value,
      publisher: TEST_PUBLISHER,
      epochNumber: 1,
      gatewayUrl: liveGateway.gatewayUrl,
      graphqlUrl: liveGateway.graphqlUrl,
      fetchImpl,
      timeoutMs: 0,
      pollIntervalMs: 0,
      sleep: async () => {},
      concurrency: 2,
      reuploadOnFailure: true,
      maxReuploadAttempts: 1,
      gatewayFallback: true,
      uploader,
      checkpoint: createEmptyCheckpoint({
        publisher: TEST_PUBLISHER,
        epochNumber: 1,
        merkleRoot: built.value.merkleRoot,
        jsonlSha256: built.value.jsonlSha256,
      }),
      checkpointPath,
    });

    expect(result.failed).toEqual([]);
    expect(result.verified).toBe(built.value.leaves.size);
    // Each leaf was re-uploaded once and its tx URI recorded for future runs.
    expect(result.checkpoint?.indexVerifiedLeafKeys.sort()).toEqual(
      [...built.value.leaves.keys()].sort(),
    );
    for (const leafKey of built.value.leaves.keys()) {
      expect(result.checkpoint?.leafUris[leafKey]).toMatch(/^ar:\/\//);
    }
  });

  it('verifies from a known leaf URI without touching GraphQL', async () => {
    const built = compile(loadGenesisMiniClaims(), {});
    if (!built.ok) {
      throw new Error(built.error.message);
    }

    const uploader = createMockUploader();
    const sortedLeaves = [...built.value.leaves.entries()].sort(([a], [b]) => a.localeCompare(b));
    let checkpoint = createEmptyCheckpoint({
      publisher: TEST_PUBLISHER,
      epochNumber: 1,
      merkleRoot: built.value.merkleRoot,
      jsonlSha256: built.value.jsonlSha256,
    });
    for (const [leafKey, entry] of sortedLeaves) {
      const upload = await uploader.upload(
        new TextEncoder().encode(JSON.stringify({ leaf: entry.leaf, proof: entry.proof })),
        [
          { name: 'App', value: 'vincent' },
          { name: 'Epoch', value: '1' },
          { name: 'LeafKey', value: leafKey },
        ],
      );
      checkpoint = setLeafUri(checkpoint, leafKey, upload.uri);
    }

    const liveGateway = createLiveMockIrysFetchImpl(uploader, TEST_PUBLISHER, 1);
    const fetchImpl = emptyGraphqlButLiveGateway(liveGateway.fetchImpl, liveGateway.graphqlUrl);

    const result = await verifyUploadedLeaves({
      epoch: built.value,
      publisher: TEST_PUBLISHER,
      epochNumber: 1,
      gatewayUrl: liveGateway.gatewayUrl,
      graphqlUrl: liveGateway.graphqlUrl,
      fetchImpl,
      timeoutMs: 0,
      pollIntervalMs: 0,
      sleep: async () => {},
      gatewayFallback: true,
      checkpoint,
      checkpointPath: testCheckpointPath(),
    });

    expect(result.failed).toEqual([]);
    expect(result.verified).toBe(built.value.leaves.size);
  });

  it('skipGraphqlPoll verifies via gateway without waiting for GraphQL poll', async () => {
    const built = compile(loadGenesisMiniClaims(), {});
    if (!built.ok) {
      throw new Error(built.error.message);
    }

    const uploader = createMockUploader();
    const sortedLeaves = [...built.value.leaves.entries()].sort(([a], [b]) => a.localeCompare(b));
    for (const [leafKey, entry] of sortedLeaves) {
      await uploader.upload(
        new TextEncoder().encode(JSON.stringify({ leaf: entry.leaf, proof: entry.proof })),
        [
          { name: 'App', value: 'vincent' },
          { name: 'Epoch', value: '1' },
          { name: 'LeafKey', value: leafKey },
        ],
      );
    }

    const liveGateway = createLiveMockIrysFetchImpl(uploader, TEST_PUBLISHER, 1);
    const emptyGraphql: typeof fetch = (input, init) => {
      const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
      if (url === liveGateway.graphqlUrl && init?.method === 'POST') {
        return Promise.resolve(
          new Response(JSON.stringify({ data: { transactions: { edges: [] } } }), { status: 200 }),
        );
      }
      return liveGateway.fetchImpl(input, init);
    };

    const start = Date.now();
    const result = await verifyUploadedLeaves({
      epoch: built.value,
      publisher: TEST_PUBLISHER,
      epochNumber: 1,
      gatewayUrl: liveGateway.gatewayUrl,
      graphqlUrl: liveGateway.graphqlUrl,
      fetchImpl: emptyGraphql,
      pollIntervalMs: 0,
      sleep: async () => {},
      concurrency: 4,
      gatewayFallback: true,
      skipGraphqlPoll: true,
      reuploadOnFailure: true,
      maxReuploadAttempts: 1,
      uploader,
      checkpoint: createEmptyCheckpoint({
        publisher: TEST_PUBLISHER,
        epochNumber: 1,
        merkleRoot: built.value.merkleRoot,
        jsonlSha256: built.value.jsonlSha256,
      }),
      checkpointPath: testCheckpointPath(),
    });
    const elapsedMs = Date.now() - start;

    expect(result.failed).toEqual([]);
    expect(result.verified).toBe(sortedLeaves.length);
    // Gateway-first must not spend 120s per leaf on GraphQL polling.
    expect(elapsedMs).toBeLessThan(30_000);
  });

  it('stops re-uploading when maxReuploadLeaves budget is exhausted', async () => {
    const built = compile(loadGenesisMiniClaims(), {});
    if (!built.ok) {
      throw new Error(built.error.message);
    }

    const uploader = createMockUploader();
    const sortedLeaves = [...built.value.leaves.entries()].sort(([a], [b]) => a.localeCompare(b));
    const leafKey = sortedLeaves[0]?.[0];
    if (leafKey === undefined) {
      throw new Error('expected leaf key');
    }

    const result = await verifyUploadedLeaves({
      epoch: built.value,
      publisher: TEST_PUBLISHER,
      epochNumber: 1,
      gatewayUrl: 'https://gateway.test',
      graphqlUrl: 'https://graphql.test',
      fetchImpl: async () =>
        new Response(JSON.stringify({ data: { transactions: { edges: [] } } }), { status: 200 }),
      pollIntervalMs: 0,
      sleep: async () => {},
      concurrency: 1,
      gatewayFallback: true,
      skipGraphqlPoll: true,
      reuploadOnFailure: true,
      maxReuploadAttempts: 2,
      maxReuploadLeaves: 0,
      uploader,
      checkpoint: createEmptyCheckpoint({
        publisher: TEST_PUBLISHER,
        epochNumber: 1,
        merkleRoot: built.value.merkleRoot,
        jsonlSha256: built.value.jsonlSha256,
      }),
      checkpointPath: testCheckpointPath(),
    });

    const failed = result.failed.find((entry) => entry.leafKey === leafKey);
    expect(failed).toBeDefined();
    expect(failed?.error).toMatch(/Re-upload budget exhausted/);
  });
});
