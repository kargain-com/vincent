import { claimHash, verifyManifest } from '@kargain/vincent/protocol';
import type { Claim, Manifest } from '@kargain/vincent/protocol';

import { compile } from './compile.js';
import type { VerifyEpochResult } from './types.js';

/**
 * Rebuild JSONL from manifest claims and verify byte-reproducibility (§6 rebuilt = true).
 */
export async function verifyEpoch(
  manifest: Manifest,
  claims: Claim[],
): Promise<VerifyEpochResult> {
  const signature = verifyManifest(manifest);
  if (!signature.ok) {
    return { ok: false, reason: signature.reason };
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

  const built = await compile(selected, { anchorOrder: manifest.claims });
  if (!built.ok) {
    return { ok: false, reason: built.error.message };
  }

  if (built.value.jsonlSha256 !== manifest.dataset.jsonlSha256) {
    return {
      ok: false,
      reason: `jsonlSha256 mismatch: expected ${manifest.dataset.jsonlSha256}, got ${built.value.jsonlSha256}`,
    };
  }

  return { ok: true };
}
