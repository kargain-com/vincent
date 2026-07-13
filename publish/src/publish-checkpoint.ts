import { mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';

export const CHECKPOINT_SCHEMA_VERSION = 2 as const;

export interface PublishCheckpoint {
  schemaVersion: typeof CHECKPOINT_SCHEMA_VERSION;
  publisher: string;
  epochNumber: number;
  merkleRoot: string;
  jsonlSha256: string;
  /** Leaves uploaded to Irys (upload phase resume). */
  uploadedLeafKeys: string[];
  /** Leaves confirmed by index-check (anchor-only resume). */
  indexVerifiedLeafKeys: string[];
  /** Leaves that failed the last index-check (input for --retry-failed). */
  failedLeafKeys: string[];
  /** leafKey -> ar://txId of the latest upload (gateway fallback). */
  leafUris: Record<string, string>;
  jsonlUri?: string;
  manifestUri?: string;
  updatedAt: string;
}

export interface CheckpointFingerprint {
  publisher: string;
  epochNumber: number;
  merkleRoot: string;
  jsonlSha256: string;
}

function normalizePublisher(publisher: string): string {
  return publisher.toLowerCase();
}

export function createEmptyCheckpoint(fingerprint: CheckpointFingerprint): PublishCheckpoint {
  return {
    schemaVersion: CHECKPOINT_SCHEMA_VERSION,
    publisher: normalizePublisher(fingerprint.publisher),
    epochNumber: fingerprint.epochNumber,
    merkleRoot: fingerprint.merkleRoot,
    jsonlSha256: fingerprint.jsonlSha256,
    uploadedLeafKeys: [],
    indexVerifiedLeafKeys: [],
    failedLeafKeys: [],
    leafUris: {},
    updatedAt: new Date().toISOString(),
  };
}

export function loadCheckpoint(path: string): PublishCheckpoint | null {
  try {
    const raw = readFileSync(path, 'utf8');
    return parseCheckpoint(JSON.parse(raw) as unknown);
  } catch (error) {
    if (error instanceof Error && 'code' in error && error.code === 'ENOENT') {
      return null;
    }
    if (error instanceof Error && error.message.startsWith('Invalid publish checkpoint')) {
      throw error;
    }
    return null;
  }
}

function parseLeafKeyArray(value: unknown, field: string): string[] {
  if (!Array.isArray(value)) {
    throw new Error(`Invalid publish checkpoint: ${field} must be an array`);
  }
  const keys: string[] = [];
  for (const key of value as unknown[]) {
    if (typeof key !== 'string' || key.length === 0) {
      throw new Error(`Invalid publish checkpoint: ${field} entries must be strings`);
    }
    keys.push(key);
  }
  return keys;
}

function parseLeafUris(value: unknown): Record<string, string> {
  if (value === undefined) return {};
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw new Error('Invalid publish checkpoint: leafUris must be an object');
  }
  const uris: Record<string, string> = {};
  for (const [leafKey, uri] of Object.entries(value)) {
    if (typeof uri !== 'string' || uri.length === 0) {
      throw new Error('Invalid publish checkpoint: leafUris values must be strings');
    }
    uris[leafKey] = uri;
  }
  return uris;
}

function parseCheckpoint(value: unknown): PublishCheckpoint {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw new Error('Invalid publish checkpoint: root must be an object');
  }
  const record = value as Record<string, unknown>;
  if (record.schemaVersion !== 1 && record.schemaVersion !== CHECKPOINT_SCHEMA_VERSION) {
    throw new Error('Invalid publish checkpoint: unsupported schemaVersion');
  }
  if (typeof record.publisher !== 'string' || record.publisher.length === 0) {
    throw new Error('Invalid publish checkpoint: publisher is required');
  }
  if (typeof record.epochNumber !== 'number' || !Number.isInteger(record.epochNumber)) {
    throw new Error('Invalid publish checkpoint: epochNumber must be an integer');
  }
  if (typeof record.merkleRoot !== 'string' || typeof record.jsonlSha256 !== 'string') {
    throw new Error('Invalid publish checkpoint: merkleRoot and jsonlSha256 are required');
  }

  // v1 conflated upload and index-verify into completedLeafKeys; those keys were
  // only recorded after a successful GraphQL verify, so migrate them as index-verified.
  const isV1 = record.schemaVersion === 1;
  const uploadedLeafKeys = isV1
    ? []
    : parseLeafKeyArray(record.uploadedLeafKeys, 'uploadedLeafKeys');
  const indexVerifiedLeafKeys = isV1
    ? parseLeafKeyArray(record.completedLeafKeys, 'completedLeafKeys')
    : parseLeafKeyArray(record.indexVerifiedLeafKeys, 'indexVerifiedLeafKeys');
  const failedLeafKeys = isV1
    ? []
    : parseLeafKeyArray(record.failedLeafKeys, 'failedLeafKeys');
  const leafUris = isV1 ? {} : parseLeafUris(record.leafUris);

  const checkpoint: PublishCheckpoint = {
    schemaVersion: CHECKPOINT_SCHEMA_VERSION,
    publisher: normalizePublisher(record.publisher),
    epochNumber: record.epochNumber,
    merkleRoot: record.merkleRoot,
    jsonlSha256: record.jsonlSha256,
    uploadedLeafKeys,
    indexVerifiedLeafKeys,
    failedLeafKeys,
    leafUris,
    updatedAt: typeof record.updatedAt === 'string' ? record.updatedAt : new Date().toISOString(),
  };
  if (typeof record.jsonlUri === 'string') checkpoint.jsonlUri = record.jsonlUri;
  if (typeof record.manifestUri === 'string') checkpoint.manifestUri = record.manifestUri;
  return checkpoint;
}

export function validateCheckpointFingerprint(
  checkpoint: PublishCheckpoint,
  fingerprint: CheckpointFingerprint,
): void {
  const expected = createEmptyCheckpoint(fingerprint);
  if (checkpoint.publisher !== expected.publisher) {
    throw new Error(
      'Checkpoint publisher mismatch. Delete the checkpoint file or use --checkpoint-file.',
    );
  }
  if (checkpoint.epochNumber !== expected.epochNumber) {
    throw new Error('Checkpoint epochNumber mismatch. Delete the checkpoint file to restart.');
  }
  if (checkpoint.merkleRoot !== expected.merkleRoot || checkpoint.jsonlSha256 !== expected.jsonlSha256) {
    throw new Error(
      'Checkpoint merkleRoot/jsonlSha256 mismatch. Delete the checkpoint before a different build.',
    );
  }
}

export function uploadedLeafKeySet(checkpoint: PublishCheckpoint): Set<string> {
  return new Set(checkpoint.uploadedLeafKeys);
}

export function indexVerifiedLeafKeySet(checkpoint: PublishCheckpoint): Set<string> {
  return new Set(checkpoint.indexVerifiedLeafKeys);
}

export function failedLeafKeySet(checkpoint: PublishCheckpoint): Set<string> {
  return new Set(checkpoint.failedLeafKeys);
}

function withoutKey(keys: string[], leafKey: string): string[] {
  return keys.includes(leafKey) ? keys.filter((key) => key !== leafKey) : keys;
}

function withKey(keys: string[], leafKey: string): string[] {
  return keys.includes(leafKey) ? keys : [...keys, leafKey];
}

/** Record a successful upload; clears any previous failure for the leaf. */
export function markLeafUploaded(
  checkpoint: PublishCheckpoint,
  leafKey: string,
  uri?: string,
): PublishCheckpoint {
  return {
    ...checkpoint,
    uploadedLeafKeys: withKey(checkpoint.uploadedLeafKeys, leafKey),
    failedLeafKeys: withoutKey(checkpoint.failedLeafKeys, leafKey),
    leafUris: uri === undefined ? checkpoint.leafUris : { ...checkpoint.leafUris, [leafKey]: uri },
    updatedAt: new Date().toISOString(),
  };
}

/** Record a successful index verification; clears any previous failure. */
export function markLeafIndexVerified(
  checkpoint: PublishCheckpoint,
  leafKey: string,
): PublishCheckpoint {
  return {
    ...checkpoint,
    indexVerifiedLeafKeys: withKey(checkpoint.indexVerifiedLeafKeys, leafKey),
    failedLeafKeys: withoutKey(checkpoint.failedLeafKeys, leafKey),
    updatedAt: new Date().toISOString(),
  };
}

export function markLeafFailed(checkpoint: PublishCheckpoint, leafKey: string): PublishCheckpoint {
  if (checkpoint.failedLeafKeys.includes(leafKey)) return checkpoint;
  return {
    ...checkpoint,
    failedLeafKeys: [...checkpoint.failedLeafKeys, leafKey],
    updatedAt: new Date().toISOString(),
  };
}

export function clearLeafFailed(checkpoint: PublishCheckpoint, leafKey: string): PublishCheckpoint {
  if (!checkpoint.failedLeafKeys.includes(leafKey)) return checkpoint;
  return {
    ...checkpoint,
    failedLeafKeys: withoutKey(checkpoint.failedLeafKeys, leafKey),
    updatedAt: new Date().toISOString(),
  };
}

export function setLeafUri(
  checkpoint: PublishCheckpoint,
  leafKey: string,
  uri: string,
): PublishCheckpoint {
  return {
    ...checkpoint,
    leafUris: { ...checkpoint.leafUris, [leafKey]: uri },
    updatedAt: new Date().toISOString(),
  };
}

export function saveCheckpoint(path: string, checkpoint: PublishCheckpoint): void {
  mkdirSync(dirname(path), { recursive: true });
  const tempPath = `${path}.tmp`;
  writeFileSync(tempPath, `${JSON.stringify(checkpoint, null, 2)}\n`, 'utf8');
  renameSync(tempPath, path);
}

export function loadOrCreateCheckpoint(
  path: string,
  fingerprint: CheckpointFingerprint,
): PublishCheckpoint {
  const existing = loadCheckpoint(path);
  if (existing === null) return createEmptyCheckpoint(fingerprint);
  validateCheckpointFingerprint(existing, fingerprint);
  return existing;
}

export function updateCheckpointUris(
  checkpoint: PublishCheckpoint,
  uris: { jsonlUri?: string; manifestUri?: string },
): PublishCheckpoint {
  return {
    ...checkpoint,
    jsonlUri: uris.jsonlUri ?? checkpoint.jsonlUri,
    manifestUri: uris.manifestUri ?? checkpoint.manifestUri,
    updatedAt: new Date().toISOString(),
  };
}
