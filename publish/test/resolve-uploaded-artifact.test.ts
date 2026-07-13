import { compile } from '@kargain/vincent-compiler';
import { gzipSync } from 'node:zlib';
import { describe, expect, it } from 'vitest';

import { manifestHash, signManifest } from '../src/sign-manifest.js';
import { buildManifest } from '../src/build-manifest.js';
import { DEFAULT_GENESIS_REVIEW_POLICY } from '../src/constants.js';
import { resolveUploadedArtifactUri } from '../src/resolve-uploaded-artifact.js';
import { TEST_PRIVATE_KEY, TEST_PUBLISHER } from '../src/index.js';
import { loadGenesisMiniClaims } from './helpers.js';
import { createMockIrysGateway } from './mock-irys-gateway.js';
import { createMockUploader } from './mock-uploader.js';

describe('resolveUploadedArtifactUri', () => {
  it('resolves the newest jsonl artifact by Type tag', async () => {
    const built = compile(loadGenesisMiniClaims(), {});
    if (!built.ok) {
      throw new Error(built.error.message);
    }

    const uploader = createMockUploader();
    await uploader.upload(gzipSync(new TextEncoder().encode(built.value.jsonl)), [
      { name: 'App', value: 'vincent' },
      { name: 'Epoch', value: '1' },
      { name: 'Type', value: 'jsonl' },
    ]);

    const { gatewayUrl, graphqlUrl, fetchImpl } = createMockIrysGateway(
      uploader.records,
      TEST_PUBLISHER,
      1,
    );

    const uri = await resolveUploadedArtifactUri({
      gatewayUrl,
      graphqlUrl,
      fetchImpl,
      publisher: TEST_PUBLISHER,
      epochNumber: 1,
      artifactType: 'jsonl',
      expectedJsonlSha256: built.value.jsonlSha256,
    });

    expect(uri).toMatch(/^ar:\/\/mock-/);
  });

  it('resolves the newest manifest artifact and verifies manifestHash', async () => {
    const built = compile(loadGenesisMiniClaims(), {});
    if (!built.ok) {
      throw new Error(built.error.message);
    }

    const unsigned = buildManifest({
      epoch: 1,
      parentRoot: null,
      merkleRoot: built.value.merkleRoot,
      jsonlSha256: built.value.jsonlSha256,
      uris: ['ar://jsonl'],
      compiler: { name: 'vincent-compiler', version: '0.0.1' },
      reviewPolicy: DEFAULT_GENESIS_REVIEW_POLICY,
    });
    const signed = signManifest(unsigned, TEST_PRIVATE_KEY);
    const hash = manifestHash(signed);

    const uploader = createMockUploader();
    await uploader.upload(new TextEncoder().encode(JSON.stringify(signed)), [
      { name: 'App', value: 'vincent' },
      { name: 'Epoch', value: '1' },
      { name: 'Type', value: 'manifest' },
    ]);

    const { gatewayUrl, graphqlUrl, fetchImpl } = createMockIrysGateway(
      uploader.records,
      TEST_PUBLISHER,
      1,
    );

    const uri = await resolveUploadedArtifactUri({
      gatewayUrl,
      graphqlUrl,
      fetchImpl,
      publisher: TEST_PUBLISHER,
      epochNumber: 1,
      artifactType: 'manifest',
      expectedManifestHash: hash,
    });

    expect(uri).toMatch(/^ar:\/\/mock-/);
  });
});
