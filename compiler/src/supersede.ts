import { claimHash } from '@kargain/vincent/protocol';
import type { Claim } from '@kargain/vincent/protocol';

/** Remove claims superseded by another claim in the set (§7.2). */
export function applySupersession(claims: Claim[]): Claim[] {
  const hashByClaim = new Map<string, Claim>();
  for (const claim of claims) {
    hashByClaim.set(claimHash(claim), claim);
  }

  const removed = new Set<string>();
  for (const claim of claims) {
    if (claim.supersedes !== undefined && hashByClaim.has(claim.supersedes)) {
      removed.add(claim.supersedes);
    }
  }

  return claims.filter((claim) => !removed.has(claimHash(claim)));
}
