import { writeFileSync } from 'node:fs';

import { describe, expect, it } from 'vitest';

import { TEST_PUBLISHER } from '../src/constants.js';
import {
  clearLeafFailed,
  createEmptyCheckpoint,
  formatLeafUriBackfillHint,
  loadOrCreateCheckpoint,
  markLeafFailed,
  markLeafIndexVerified,
  markLeafUploaded,
  needsLeafUriBackfillHint,
  saveCheckpoint,
  setLeafUri,
  validateCheckpointFingerprint,
  writeLeafUriBackfillHintIfNeeded,
} from '../src/publish-checkpoint.js';
import { testCheckpointPath } from './helpers.js';

describe('publish checkpoint', () => {
  const fingerprint = {
    publisher: TEST_PUBLISHER,
    epochNumber: 2,
    merkleRoot: 'sha256:' + 'a'.repeat(64),
    jsonlSha256: 'sha256:' + 'b'.repeat(64),
  };

  it('creates an empty checkpoint when the file is missing', () => {
    const path = testCheckpointPath();
    const checkpoint = loadOrCreateCheckpoint(path, fingerprint);
    expect(checkpoint.schemaVersion).toBe(2);
    expect(checkpoint.uploadedLeafKeys).toEqual([]);
    expect(checkpoint.indexVerifiedLeafKeys).toEqual([]);
    expect(checkpoint.failedLeafKeys).toEqual([]);
    expect(checkpoint.leafUris).toEqual({});
    expect(checkpoint.publisher).toBe(TEST_PUBLISHER.toLowerCase());
    expect(checkpoint.epochNumber).toBe(2);
  });

  it('accepts a checkpoint when the fingerprint matches', () => {
    const path = testCheckpointPath();
    const initial = markLeafUploaded(createEmptyCheckpoint(fingerprint), '1FA', 'ar://tx-1FA');
    saveCheckpoint(path, initial);

    const loaded = loadOrCreateCheckpoint(path, fingerprint);
    expect(loaded.uploadedLeafKeys).toEqual(['1FA']);
    expect(loaded.leafUris).toEqual({ '1FA': 'ar://tx-1FA' });
  });

  it('migrates a v1 checkpoint, preserving completed keys as index-verified', () => {
    const path = testCheckpointPath();
    writeFileSync(
      path,
      JSON.stringify({
        schemaVersion: 1,
        publisher: TEST_PUBLISHER,
        epochNumber: 2,
        merkleRoot: fingerprint.merkleRoot,
        jsonlSha256: fingerprint.jsonlSha256,
        completedLeafKeys: ['1FA', '2GB'],
        jsonlUri: 'ar://jsonl',
        manifestUri: 'ar://manifest',
        updatedAt: new Date().toISOString(),
      }),
      'utf8',
    );

    const loaded = loadOrCreateCheckpoint(path, fingerprint);
    expect(loaded.schemaVersion).toBe(2);
    expect(loaded.indexVerifiedLeafKeys).toEqual(['1FA', '2GB']);
    expect(loaded.uploadedLeafKeys).toEqual([]);
    expect(loaded.failedLeafKeys).toEqual([]);
    expect(loaded.leafUris).toEqual({});
    expect(needsLeafUriBackfillHint(loaded)).toBe(true);
    expect(loaded.jsonlUri).toBe('ar://jsonl');
    expect(loaded.manifestUri).toBe('ar://manifest');

    saveCheckpoint(path, loaded);
    const reloaded = loadOrCreateCheckpoint(path, fingerprint);
    expect(reloaded.schemaVersion).toBe(2);
    expect(reloaded.indexVerifiedLeafKeys).toEqual(['1FA', '2GB']);
  });

  it('tracks failed leaves and clears them on upload or verify', () => {
    let checkpoint = markLeafFailed(createEmptyCheckpoint(fingerprint), '1FA');
    checkpoint = markLeafFailed(checkpoint, '2GB');
    expect(checkpoint.failedLeafKeys).toEqual(['1FA', '2GB']);

    checkpoint = markLeafUploaded(checkpoint, '1FA', 'ar://tx-new');
    expect(checkpoint.failedLeafKeys).toEqual(['2GB']);
    expect(checkpoint.uploadedLeafKeys).toEqual(['1FA']);

    checkpoint = markLeafIndexVerified(checkpoint, '2GB');
    expect(checkpoint.failedLeafKeys).toEqual([]);
    expect(checkpoint.indexVerifiedLeafKeys).toEqual(['2GB']);

    checkpoint = markLeafFailed(checkpoint, '3HC');
    checkpoint = clearLeafFailed(checkpoint, '3HC');
    expect(checkpoint.failedLeafKeys).toEqual([]);
  });

  it('stores leaf URIs for gateway fallback', () => {
    let checkpoint = setLeafUri(createEmptyCheckpoint(fingerprint), '1FA', 'ar://tx-a');
    checkpoint = setLeafUri(checkpoint, '1FA', 'ar://tx-b');
    expect(checkpoint.leafUris['1FA']).toBe('ar://tx-b');
  });

  it('rejects a checkpoint when the publisher mismatches', () => {
    const path = testCheckpointPath();
    saveCheckpoint(
      path,
      createEmptyCheckpoint({
        ...fingerprint,
        publisher: '0x' + '1'.repeat(40),
      }),
    );

    expect(() => loadOrCreateCheckpoint(path, fingerprint)).toThrow(/publisher mismatch/);
  });

  it('rejects a checkpoint when merkleRoot mismatches', () => {
    const path = testCheckpointPath();
    saveCheckpoint(path, createEmptyCheckpoint(fingerprint));

    expect(() =>
      validateCheckpointFingerprint(createEmptyCheckpoint(fingerprint), {
        ...fingerprint,
        merkleRoot: 'sha256:' + 'c'.repeat(64),
      }),
    ).toThrow(/merkleRoot\/jsonlSha256 mismatch/);
  });

  it('detects when leafUri backfill is recommended', () => {
    const migrated = loadOrCreateCheckpoint(testCheckpointPath(), fingerprint);
    let checkpoint = markLeafIndexVerified(migrated, '1FA');
    checkpoint = markLeafIndexVerified(checkpoint, '2GB');

    expect(needsLeafUriBackfillHint(checkpoint)).toBe(true);
    expect(formatLeafUriBackfillHint(checkpoint)).toContain('backfill:leaf-uris');
    expect(formatLeafUriBackfillHint(checkpoint)).toContain('--epoch 2');

    checkpoint = markLeafUploaded(checkpoint, '1FA', 'ar://tx-1FA');
    expect(needsLeafUriBackfillHint(checkpoint)).toBe(false);
  });

  it('writes the backfill hint to stderr when needed', () => {
    let checkpoint = markLeafIndexVerified(createEmptyCheckpoint(fingerprint), '1FA');
    const messages: string[] = [];

    expect(writeLeafUriBackfillHintIfNeeded(checkpoint, (message) => messages.push(message))).toBe(
      true,
    );
    expect(messages).toHaveLength(1);
    expect(messages[0]).toContain('backfill:leaf-uris');

    checkpoint = markLeafUploaded(checkpoint, '1FA', 'ar://tx-1FA');
    expect(writeLeafUriBackfillHintIfNeeded(checkpoint, (message) => messages.push(message))).toBe(
      false,
    );
    expect(messages).toHaveLength(1);
  });
});
