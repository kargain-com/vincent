import type { Claim } from '@kargain/vincent/protocol';

import { prepareClaims, type PreparedClaim } from './prepared-claim.js';
import type { CompileResult } from './types.js';

/** Validate every claim: parse-time well-formedness only (no per-claim signatures). */
export function validateClaims(claims: Claim[]): CompileResult<Claim[]> {
  const prepared = prepareClaims(claims);
  if (!prepared.ok) {
    return prepared;
  }
  return { ok: true, value: prepared.value.map((entry) => entry.claim) };
}

export { prepareClaims, type PreparedClaim };
