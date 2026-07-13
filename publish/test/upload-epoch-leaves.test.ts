import { compile } from '@kargain/vincent-compiler';
import { describe, expect, it } from 'vitest';

import { TEST_PUBLISHER } from '../src/constants.js';
import { createEmptyCheckpoint } from '../src/publish-checkpoint.js';
import { uploadEpochLeaves } from '../src/upload-epoch-leaves.js';
import { loadGenesisMiniClaims, testCheckpointPath } from './helpers.js';
import { createMockUploader } from './mock-uploader.js';

describe('uploadEpochLeaves', () => {
  it('respects the concurrency limit', async () => {
    const built = compile(loadGenesisMiniClaims(), {});
    if (!built.ok) {
      throw new Error(built.error.message);
    }

    const uploader = createMockUploader();
    let inFlight = 0;
    let maxInFlight = 0;
    const originalUpload = uploader.upload.bind(uploader);
    uploader.upload = async (...args) => {
      inFlight += 1;
      maxInFlight = Math.max(maxInFlight, inFlight);
      await new Promise((resolve) => setTimeout(resolve, 5));
      try {
        return await originalUpload(...args);
      } finally {
        inFlight -= 1;
      }
    };

    const checkpointPath = testCheckpointPath();
    await uploadEpochLeaves({
      epoch: built.value,
      epochNumber: 1,
      uploader,
      checkpoint: createEmptyCheckpoint({
        publisher: TEST_PUBLISHER,
        epochNumber: 1,
        merkleRoot: built.value.merkleRoot,
        jsonlSha256: built.value.jsonlSha256,
      }),
      checkpointPath,
      concurrency: 2,
    });

    expect(maxInFlight).toBeLessThanOrEqual(2);
    expect(maxInFlight).toBeGreaterThan(1);
  });

  it('skips leaves already present in the checkpoint', async () => {
    const built = compile(loadGenesisMiniClaims(), {});
    if (!built.ok) {
      throw new Error(built.error.message);
    }

    const sortedLeaves = [...built.value.leaves.entries()].sort(([a], [b]) => a.localeCompare(b));
    const checkpointPath = testCheckpointPath();
    let checkpoint = createEmptyCheckpoint({
      publisher: TEST_PUBLISHER,
      epochNumber: 1,
      merkleRoot: built.value.merkleRoot,
      jsonlSha256: built.value.jsonlSha256,
    });
    for (const [leafKey] of sortedLeaves) {
      checkpoint = {
        ...checkpoint,
        uploadedLeafKeys: [...checkpoint.uploadedLeafKeys, leafKey],
      };
    }

    const uploader = createMockUploader();
    const result = await uploadEpochLeaves({
      epoch: built.value,
      epochNumber: 1,
      uploader,
      checkpoint,
      checkpointPath,
      concurrency: 4,
    });

    expect(result.uploaded).toBe(0);
    expect(result.skipped).toBe(sortedLeaves.length);
    expect(uploader.records).toHaveLength(0);
  });

  it('records the upload uri per leaf for gateway fallback', async () => {
    const built = compile(loadGenesisMiniClaims(), {});
    if (!built.ok) {
      throw new Error(built.error.message);
    }

    const uploader = createMockUploader();
    const result = await uploadEpochLeaves({
      epoch: built.value,
      epochNumber: 1,
      uploader,
      checkpoint: createEmptyCheckpoint({
        publisher: TEST_PUBLISHER,
        epochNumber: 1,
        merkleRoot: built.value.merkleRoot,
        jsonlSha256: built.value.jsonlSha256,
      }),
      checkpointPath: testCheckpointPath(),
      concurrency: 4,
    });

    for (const leafKey of result.checkpoint.uploadedLeafKeys) {
      expect(result.checkpoint.leafUris[leafKey]).toMatch(/^ar:\/\//);
    }
  });

  it('uploads only onlyLeafKeys, even when already marked uploaded', async () => {
    const built = compile(loadGenesisMiniClaims(), {});
    if (!built.ok) {
      throw new Error(built.error.message);
    }

    const sortedLeaves = [...built.value.leaves.entries()].sort(([a], [b]) => a.localeCompare(b));
    let checkpoint = createEmptyCheckpoint({
      publisher: TEST_PUBLISHER,
      epochNumber: 1,
      merkleRoot: built.value.merkleRoot,
      jsonlSha256: built.value.jsonlSha256,
    });
    for (const [leafKey] of sortedLeaves) {
      checkpoint = {
        ...checkpoint,
        uploadedLeafKeys: [...checkpoint.uploadedLeafKeys, leafKey],
      };
    }
    const failedKeys = sortedLeaves.slice(0, 2).map(([leafKey]) => leafKey);
    checkpoint = { ...checkpoint, failedLeafKeys: [...failedKeys] };

    const uploader = createMockUploader();
    const result = await uploadEpochLeaves({
      epoch: built.value,
      epochNumber: 1,
      uploader,
      checkpoint,
      checkpointPath: testCheckpointPath(),
      concurrency: 4,
      onlyLeafKeys: failedKeys,
    });

    expect(result.uploaded).toBe(2);
    expect(uploader.records).toHaveLength(2);
    expect(result.checkpoint.failedLeafKeys).toEqual([]);
    for (const leafKey of failedKeys) {
      expect(result.checkpoint.leafUris[leafKey]).toMatch(/^ar:\/\//);
    }
  });
});
