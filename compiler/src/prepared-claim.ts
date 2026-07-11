import { canonicalize, parseClaim } from '@kargain/vincent/protocol';
import type { Claim } from '@kargain/vincent/protocol';

import { contentSha256 } from './hash-content.js';
import { fail, type CompileResult } from './types.js';

export interface PreparedClaim {
  claim: Claim;
  hash: string;
  canonical: string;
}

export interface PrepareClaimsOptions {
  progress?: (message: string) => void;
}

/** Validate claims and precompute hash + canonical JSON once per claim. */
export function prepareClaims(
  claims: Claim[],
  options: PrepareClaimsOptions = {},
): CompileResult<PreparedClaim[]> {
  const seen = new Set<string>();
  const prepared: PreparedClaim[] = [];

  for (let index = 0; index < claims.length; index++) {
    const claim = claims[index];
    const parsed = parseClaim(claim);
    if (!parsed.ok) {
      return fail(parsed.error.code, parsed.error.message);
    }

    const canonical = canonicalize(parsed.value);
    const hash = contentSha256(canonical);
    if (seen.has(hash)) {
      return fail('duplicate-claim', `duplicate claim hash in input: ${hash}`);
    }
    seen.add(hash);
    prepared.push({ claim: parsed.value, hash, canonical });

    if (options.progress !== undefined && (index + 1) % 100_000 === 0) {
      options.progress(`  prepared ${String(index + 1)} claims...`);
    }
  }

  return { ok: true, value: prepared };
}
