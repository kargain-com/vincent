import type { ReviewPolicy, UnsignedManifest } from '@kargain/vincent/protocol';

import {
  DEFAULT_GENESIS_REVIEW_POLICY,
  isSha256Hash,
  isZeroParentRoot,
} from './constants.js';
import type { BuildManifestInput } from './types.js';

function assertSha256Hash(value: string, field: string): void {
  if (!isSha256Hash(value)) {
    throw new Error(`${field} must be sha256:<64 lowercase hex>`);
  }
}

function resolveParent(input: BuildManifestInput): string | null {
  if (input.epoch === 1) {
    if (!isZeroParentRoot(input.parentRoot)) {
      throw new Error('genesis epoch requires parentRoot to be null or zero');
    }
    return null;
  }
  if (isZeroParentRoot(input.parentRoot)) {
    throw new Error('non-genesis epoch requires prior merkleRoot as parentRoot');
  }
  assertSha256Hash(input.parentRoot!, 'parentRoot');
  return input.parentRoot;
}

/** Build an unsigned epoch manifest (deterministic JCS shape; omits claims). */
export function buildManifest(input: BuildManifestInput): UnsignedManifest {
  if (!Number.isInteger(input.epoch) || input.epoch < 1) {
    throw new Error('epoch must be a positive integer');
  }

  assertSha256Hash(input.merkleRoot, 'merkleRoot');
  assertSha256Hash(input.jsonlSha256, 'jsonlSha256');

  if (input.uris.length === 0) {
    throw new Error('uris must contain at least one entry');
  }
  for (const uri of input.uris) {
    if (typeof uri !== 'string' || uri.length === 0) {
      throw new Error('each uri must be a non-empty string');
    }
  }

  if (input.compiler.name.length === 0 || input.compiler.version.length === 0) {
    throw new Error('compiler name and version must be non-empty');
  }

  const reviewPolicy: ReviewPolicy = input.reviewPolicy ?? {
    minAccepts: DEFAULT_GENESIS_REVIEW_POLICY.minAccepts,
    reviewers: [...DEFAULT_GENESIS_REVIEW_POLICY.reviewers],
  };

  return {
    schemaVersion: '1.0',
    epoch: input.epoch,
    parent: resolveParent(input),
    reviewPolicy,
    compiler: { name: input.compiler.name, version: input.compiler.version },
    dataset: {
      jsonlSha256: input.jsonlSha256,
      merkleRoot: input.merkleRoot,
      uris: [...input.uris],
    },
  };
}
