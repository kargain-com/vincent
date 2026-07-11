import { claimHash, parseClaim, verifyClaim } from '@kargain/vincent/protocol';
import type { Claim } from '@kargain/vincent/protocol';

import { fail, type CompileResult } from './types.js';

/** Validate every claim: well-formed parse + signature verify. */
export function validateClaims(claims: Claim[]): CompileResult<Claim[]> {
  const seen = new Set<string>();

  for (const claim of claims) {
    const parsed = parseClaim(claim);
    if (!parsed.ok) {
      return fail(parsed.error.code, parsed.error.message);
    }

    const verified = verifyClaim(parsed.value);
    if (!verified.ok) {
      return fail('invalid-signature', verified.reason);
    }

    const hash = claimHash(parsed.value);
    if (seen.has(hash)) {
      return fail('duplicate-claim', `duplicate claim hash in input: ${hash}`);
    }
    seen.add(hash);
  }

  return { ok: true, value: claims };
}
