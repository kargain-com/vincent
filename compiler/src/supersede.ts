import type { PreparedClaim } from './prepared-claim.js';

/** Remove prepared claims superseded by another claim in the set (§7.2). */
export function applySupersession(prepared: PreparedClaim[]): PreparedClaim[] {
  const hashByClaim = new Map<string, PreparedClaim>();
  for (const entry of prepared) {
    hashByClaim.set(entry.hash, entry);
  }

  const removed = new Set<string>();
  for (const entry of prepared) {
    if (entry.claim.supersedes !== undefined && hashByClaim.has(entry.claim.supersedes)) {
      removed.add(entry.claim.supersedes);
    }
  }

  return prepared.filter((entry) => !removed.has(entry.hash));
}
