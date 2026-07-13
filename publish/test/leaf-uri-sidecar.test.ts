import { describe, expect, it, vi } from 'vitest';

import {
  buildLeafUriSidecarFromCheckpoint,
  publishLeafUriSidecarFromCheckpoint,
  uploadLeafUriSidecar,
} from '../src/leaf-uri-sidecar.js';
import { createEmptyCheckpoint, setLeafUriSidecarUri } from '../src/publish-checkpoint.js';

const FINGERPRINT = {
  publisher: '0xa0e58EC0f3dF4f127e9203A7fd6a494c483719B3',
  epochNumber: 2,
  merkleRoot: `sha256:${'a'.repeat(64)}`,
  jsonlSha256: `sha256:${'b'.repeat(64)}`,
};

describe('publish leaf uri sidecar', () => {
  it('uploads with Kind=leaf-uris tags', async () => {
    const sidecar = buildLeafUriSidecarFromCheckpoint({
      ...createEmptyCheckpoint(FINGERPRINT),
      leafUris: { '1FA': 'ar://tx-1' },
    });
    const upload = vi.fn(async () => ({ id: 'tx-sidecar', uri: 'ar://tx-sidecar' }));
    const uploader = { upload };

    const result = await uploadLeafUriSidecar({
      uploader,
      sidecar,
      epochNumber: 2,
    });

    expect(result.uri).toBe('ar://tx-sidecar');
    expect(upload).toHaveBeenCalledOnce();
    const tags = upload.mock.calls[0]?.[1] as Array<{ name: string; value: string }>;
    expect(tags).toEqual(
      expect.arrayContaining([
        { name: 'App', value: 'vincent' },
        { name: 'Epoch', value: '2' },
        { name: 'Kind', value: 'leaf-uris' },
      ]),
    );
  });

  it('persists leafUriSidecarUri on checkpoint helpers', () => {
    const checkpoint = setLeafUriSidecarUri(
      createEmptyCheckpoint(FINGERPRINT),
      'ar://tx-sidecar',
    );
    expect(checkpoint.leafUriSidecarUri).toBe('ar://tx-sidecar');
  });

  it('rejects empty checkpoint leafUris', async () => {
    await expect(
      publishLeafUriSidecarFromCheckpoint({
        uploader: { upload: vi.fn() },
        checkpoint: createEmptyCheckpoint(FINGERPRINT),
      }),
    ).rejects.toThrow(/leafUris is empty/);
  });
});
