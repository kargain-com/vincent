import { claimHash, verifyManifest } from '@kargain/vincent/protocol';
import type { Claim, Manifest } from '@kargain/vincent/protocol';

import { compile } from './compile.js';
import type { EpochBuild, VerifyEpochResult } from './types.js';

function compareDatasetHashes(manifest: Manifest, built: EpochBuild): VerifyEpochResult {
  if (built.jsonlSha256 !== manifest.dataset.jsonlSha256) {
    return {
      ok: false,
      reason: `jsonlSha256 mismatch: expected ${manifest.dataset.jsonlSha256}, got ${built.jsonlSha256}`,
    };
  }

  if (built.merkleRoot !== manifest.dataset.merkleRoot) {
    return {
      ok: false,
      reason: `merkleRoot mismatch: expected ${manifest.dataset.merkleRoot}, got ${built.merkleRoot}`,
    };
  }

  return { ok: true };
}

/**
 * Rebuild JSONL and Merkle root and verify byte-reproducibility against manifest.dataset.
 *
 * - Inline claims (`manifest.claims` present): resolve listed hashes, compile with anchor order.
 * - Claims omitted (genesis / large epoch): compile the provided claim set directly.
 *
 * Manifest signature is always verified first (fail-closed).
 */
export function verifyEpoch(
  manifest: Manifest,
  claims: Claim[],
): VerifyEpochResult {
  const signature = verifyManifest(manifest);
  if (!signature.ok) {
    return { ok: false, reason: signature.reason };
  }

  if (manifest.claims === undefined) {
    const built = compile(claims, {});
    if (!built.ok) {
      return { ok: false, reason: built.error.message };
    }
    return compareDatasetHashes(manifest, built.value);
  }

  const claimByHash = new Map<string, Claim>();
  for (const claim of claims) {
    claimByHash.set(claimHash(claim), claim);
  }

  const selected: Claim[] = [];
  for (const hash of manifest.claims) {
    const claim = claimByHash.get(hash);
    if (claim === undefined) {
      return { ok: false, reason: `missing claim for manifest hash ${hash}` };
    }
    selected.push(claim);
  }

  const built = compile(selected, { anchorOrder: manifest.claims });
  if (!built.ok) {
    return { ok: false, reason: built.error.message };
  }

  return compareDatasetHashes(manifest, built.value);
}
