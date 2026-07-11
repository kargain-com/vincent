import { claimHash } from '@kargain/vincent/protocol';
import type { Claim } from '@kargain/vincent/protocol';

import { resolveConflicts } from './conflict.js';
import { emitJsonl } from './jsonl.js';
import { sortClaimsForJsonl } from './sort-claims.js';
import { buildSqlite } from './sqlite.js';
import { applySupersession } from './supersede.js';
import {
  emptyByType,
  fail,
  type CompilePolicy,
  type CompileResult,
  type EpochBuild,
} from './types.js';
import { validateClaims } from './validate.js';

function buildAnchorIndex(
  claims: Claim[],
  policy: CompilePolicy,
): CompileResult<Map<string, number>> {
  const map = new Map<string, number>();

  if (policy.anchorOrder !== undefined) {
    for (let index = 0; index < policy.anchorOrder.length; index++) {
      const hash = policy.anchorOrder[index];
      if (map.has(hash) && policy.anchorRank?.[hash] === undefined) {
        return fail('duplicate-anchor', `duplicate hash in anchorOrder: ${hash}`);
      }
      if (!map.has(hash)) {
        map.set(hash, policy.anchorRank?.[hash] ?? index);
      }
    }

    for (const claim of claims) {
      const hash = claimHash(claim);
      if (map.has(hash)) {
        if (policy.anchorRank?.[hash] !== undefined) {
          map.set(hash, policy.anchorRank[hash]);
        }
        continue;
      }
      if (policy.anchorRank?.[hash] !== undefined) {
        map.set(hash, policy.anchorRank[hash]);
        continue;
      }
      return fail('missing-anchor', `claim ${hash} not found in anchorOrder`);
    }

    return { ok: true, value: map };
  }

  for (let index = 0; index < claims.length; index++) {
    const hash = claimHash(claims[index]);
    map.set(hash, policy.anchorRank?.[hash] ?? index);
  }
  return { ok: true, value: map };
}

function countByType(claims: readonly Claim[]): Record<Claim['type'], number> {
  const counts = emptyByType();
  for (const claim of claims) {
    counts[claim.type] += 1;
  }
  return counts;
}

/**
 * Compile an accepted claim set into canonical JSONL and a derived SQLite cache.
 * Pure and deterministic for JSONL output given the same inputs and policy.
 */
export async function compile(
  claims: Claim[],
  policy: CompilePolicy = {},
): Promise<CompileResult<EpochBuild>> {
  const validated = validateClaims(claims);
  if (!validated.ok) {
    return validated;
  }

  const anchorResult = buildAnchorIndex(validated.value, policy);
  if (!anchorResult.ok) {
    return anchorResult;
  }

  const afterSupersession = applySupersession(validated.value);

  const resolved = resolveConflicts(afterSupersession, anchorResult.value);
  if (!resolved.ok) {
    return resolved;
  }

  const sorted = sortClaimsForJsonl(resolved.value);
  const { jsonl, jsonlSha256 } = emitJsonl(sorted);
  const { sqlite, sqliteSha256 } = await buildSqlite(sorted, jsonlSha256);

  return {
    ok: true,
    value: {
      jsonl,
      jsonlSha256,
      sqlite,
      sqliteSha256,
      claimCount: sorted.length,
      byType: countByType(sorted),
    },
  };
}
