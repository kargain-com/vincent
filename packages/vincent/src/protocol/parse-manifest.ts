import {
  MANIFEST_REQUIRED_KEYS,
  MANIFEST_TOP_LEVEL_KEYS,
} from './constants.js';
import {
  checkObjectKeys,
  checkRequiredKeys,
  checkTopLevelKeys,
  fail,
  isPlainObject,
  isSortedAscending,
  parseAddress,
  parseNonEmptyString,
  parsePlainObject,
  parseSchemaVersion,
  parseSha256Hash,
  parseSignature,
} from './parse-utils.js';
import type { CompilerInfo, DatasetInfo, Manifest, ParseResult, ReviewPolicy } from './types.js';

const REVIEW_POLICY_KEYS = new Set(['minAccepts', 'reviewers']);
const COMPILER_KEYS = new Set(['name', 'version']);
const DATASET_KEYS = new Set(['jsonlSha256', 'merkleRoot', 'uris']);

function parseReviewPolicy(value: unknown): ParseResult<ReviewPolicy> {
  const obj = parsePlainObject(value, 'reviewPolicy');
  if (!obj.ok) {
    return obj;
  }
  const keys = checkObjectKeys(obj.value, REVIEW_POLICY_KEYS, 'reviewPolicy');
  if (!keys.ok) {
    return keys;
  }
  if (!('minAccepts' in obj.value) || !('reviewers' in obj.value)) {
    return fail('invalid-review-policy', 'reviewPolicy requires minAccepts and reviewers');
  }
  if (
    typeof obj.value.minAccepts !== 'number' ||
    !Number.isInteger(obj.value.minAccepts) ||
    obj.value.minAccepts < 1
  ) {
    return fail('invalid-review-policy', 'reviewPolicy.minAccepts must be an integer >= 1');
  }
  if (!Array.isArray(obj.value.reviewers) || obj.value.reviewers.length === 0) {
    return fail('invalid-review-policy', 'reviewPolicy.reviewers must be a non-empty array');
  }
  const reviewers: string[] = [];
  for (const reviewer of obj.value.reviewers) {
    const parsed = parseAddress(reviewer, 'reviewer');
    if (!parsed.ok) {
      return parsed;
    }
    reviewers.push(parsed.value);
  }
  return {
    ok: true,
    value: { minAccepts: obj.value.minAccepts, reviewers },
  };
}

function parseCompiler(value: unknown): ParseResult<CompilerInfo> {
  const obj = parsePlainObject(value, 'compiler');
  if (!obj.ok) {
    return obj;
  }
  const keys = checkObjectKeys(obj.value, COMPILER_KEYS, 'compiler');
  if (!keys.ok) {
    return keys;
  }
  const name = parseNonEmptyString(obj.value.name, 'compiler.name');
  if (!name.ok) {
    return name;
  }
  const version = parseNonEmptyString(obj.value.version, 'compiler.version');
  if (!version.ok) {
    return version;
  }
  return { ok: true, value: { name: name.value, version: version.value } };
}

function parseDataset(value: unknown): ParseResult<DatasetInfo> {
  const obj = parsePlainObject(value, 'dataset');
  if (!obj.ok) {
    return obj;
  }
  const keys = checkObjectKeys(obj.value, DATASET_KEYS, 'dataset');
  if (!keys.ok) {
    return keys;
  }
  for (const field of DATASET_KEYS) {
    if (!(field in obj.value)) {
      return fail(`missing-key:${field}`, `Missing required key in dataset: ${field}`);
    }
  }
  const jsonlSha256 = parseNonEmptyString(obj.value.jsonlSha256, 'dataset.jsonlSha256');
  if (!jsonlSha256.ok) {
    return jsonlSha256;
  }
  const merkleRoot = parseSha256Hash(obj.value.merkleRoot, 'dataset.merkleRoot');
  if (!merkleRoot.ok) {
    return merkleRoot;
  }
  if (!Array.isArray(obj.value.uris) || obj.value.uris.length === 0) {
    return fail('invalid-dataset', 'dataset.uris must contain at least one URI');
  }
  const uris: string[] = [];
  for (const uri of obj.value.uris) {
    const parsed = parseNonEmptyString(uri, 'dataset.uri');
    if (!parsed.ok) {
      return fail('invalid-dataset', 'Each dataset URI must be a non-empty string');
    }
    uris.push(parsed.value);
  }
  return {
    ok: true,
    value: {
      jsonlSha256: jsonlSha256.value,
      merkleRoot: merkleRoot.value,
      uris,
    },
  };
}

function parseParent(value: unknown, epoch: number): ParseResult<string | null> {
  if (value === null) {
    if (epoch !== 1) {
      return fail('invalid-parent', 'Non-genesis manifest requires parent merkleRoot');
    }
    return { ok: true, value: null };
  }
  const parentHash = parseSha256Hash(value, 'parent');
  if (!parentHash.ok) {
    return parentHash;
  }
  if (epoch === 1) {
    return fail('invalid-parent', 'Genesis manifest parent must be null');
  }
  return { ok: true, value: parentHash.value };
}

function parseClaims(value: unknown): ParseResult<string[]> {
  if (!Array.isArray(value)) {
    return fail('invalid-claims', 'claims must be an array');
  }
  if (value.length === 0) {
    return fail('invalid-claims', 'claims must be a non-empty array');
  }
  const claims: string[] = [];
  for (const item of value) {
    const hash = parseSha256Hash(item, 'claims');
    if (!hash.ok) {
      return hash;
    }
    claims.push(hash.value);
  }
  if (!isSortedAscending(claims)) {
    return fail('unsorted-claims', 'claims must be lexicographically sorted');
  }
  return { ok: true, value: claims };
}

function parseOptionalClaims(value: unknown): ParseResult<string[] | undefined> {
  if (value === undefined) {
    return { ok: true, value: undefined };
  }
  return parseClaims(value);
}

function parseEpoch(value: unknown): ParseResult<number> {
  if (typeof value !== 'number' || !Number.isInteger(value) || value < 1) {
    return fail('invalid-epoch', 'epoch must be a positive integer');
  }
  return { ok: true, value };
}

/** Parse and validate a manifest document (fail-closed, no exceptions). */
export function parseManifest(json: unknown): ParseResult<Manifest> {
  if (!isPlainObject(json)) {
    return fail('invalid-type', 'Manifest must be a JSON object');
  }

  const topKeys = checkTopLevelKeys(json, MANIFEST_TOP_LEVEL_KEYS);
  if (!topKeys.ok) {
    return topKeys;
  }

  const required = checkRequiredKeys(json, MANIFEST_REQUIRED_KEYS);
  if (!required.ok) {
    return required;
  }

  const schemaVersion = parseSchemaVersion(json.schemaVersion);
  if (!schemaVersion.ok) {
    return schemaVersion;
  }

  const epoch = parseEpoch(json.epoch);
  if (!epoch.ok) {
    return epoch;
  }

  const parent = parseParent(json.parent, epoch.value);
  if (!parent.ok) {
    return parent;
  }

  const reviewPolicy = parseReviewPolicy(json.reviewPolicy);
  if (!reviewPolicy.ok) {
    return reviewPolicy;
  }

  const claims = parseOptionalClaims(json.claims);
  if (!claims.ok) {
    return claims;
  }

  const compiler = parseCompiler(json.compiler);
  if (!compiler.ok) {
    return compiler;
  }

  const dataset = parseDataset(json.dataset);
  if (!dataset.ok) {
    return dataset;
  }

  const publisher = parseAddress(json.publisher, 'publisher');
  if (!publisher.ok) {
    return publisher;
  }

  const signature = parseSignature(json.signature);
  if (!signature.ok) {
    return signature;
  }

  return {
    ok: true,
    value: {
      schemaVersion: schemaVersion.value,
      epoch: epoch.value,
      parent: parent.value,
      reviewPolicy: reviewPolicy.value,
      ...(claims.value !== undefined ? { claims: claims.value } : {}),
      compiler: compiler.value,
      dataset: dataset.value,
      publisher: publisher.value,
      signature: signature.value,
    },
  };
}
