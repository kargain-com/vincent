import type { Claim } from '@kargain/vincent/protocol';

import { resolveConflicts } from './conflict.js';
import { emitJsonlFromPrepared } from './jsonl.js';
import { buildLeaves, compareStrings } from './leaves.js';
import { buildMerkle } from './merkle.js';
import { prepareClaims } from './prepared-claim.js';
import { sortPreparedClaimsForJsonl } from './sort-claims.js';
import { applySupersession } from './supersede.js';
import {
  emptyByType,
  fail,
  type CompilePolicy,
  type CompileResult,
  type CompileStageTimingMs,
  type EpochBuild,
  type EpochLeaf,
} from './types.js';
import type { PreparedClaim } from './prepared-claim.js';

function buildAnchorIndex(
  prepared: PreparedClaim[],
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

    for (const entry of prepared) {
      if (map.has(entry.hash)) {
        if (policy.anchorRank?.[entry.hash] !== undefined) {
          map.set(entry.hash, policy.anchorRank[entry.hash]);
        }
        continue;
      }
      if (policy.anchorRank?.[entry.hash] !== undefined) {
        map.set(entry.hash, policy.anchorRank[entry.hash]);
        continue;
      }
      return fail('missing-anchor', `claim ${entry.hash} not found in anchorOrder`);
    }

    return { ok: true, value: map };
  }

  for (let index = 0; index < prepared.length; index++) {
    map.set(prepared[index].hash, policy.anchorRank?.[prepared[index].hash] ?? index);
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

function logProgress(policy: CompilePolicy, message: string): void {
  policy.progress?.(message);
}

/**
 * Compile an accepted claim set into canonical JSONL, per-WMI leaves, and Merkle root.
 * Pure and deterministic given the same inputs and policy.
 */
export function compile(
  claims: Claim[],
  policy: CompilePolicy = {},
): CompileResult<EpochBuild> {
  const stageTimingMs: CompileStageTimingMs = {
    prepare: 0,
    anchor: 0,
    supersession: 0,
    conflict: 0,
    sort: 0,
    jsonl: 0,
    leaves: 0,
    merkle: 0,
  };

  logProgress(policy, `Preparing ${String(claims.length)} claims...`);
  const prepareStart = performance.now();
  const preparedResult = prepareClaims(claims, { progress: policy.progress });
  stageTimingMs.prepare = performance.now() - prepareStart;
  if (!preparedResult.ok) {
    return preparedResult;
  }
  logProgress(policy, `Prepared ${String(preparedResult.value.length)} claims`);

  logProgress(policy, 'Building anchor index...');
  const anchorStart = performance.now();
  const anchorResult = buildAnchorIndex(preparedResult.value, policy);
  stageTimingMs.anchor = performance.now() - anchorStart;
  if (!anchorResult.ok) {
    return anchorResult;
  }

  logProgress(policy, 'Applying supersession...');
  const supersessionStart = performance.now();
  const afterSupersession = applySupersession(preparedResult.value);
  stageTimingMs.supersession = performance.now() - supersessionStart;

  logProgress(policy, 'Resolving conflicts...');
  const conflictStart = performance.now();
  const resolved = resolveConflicts(afterSupersession, anchorResult.value);
  stageTimingMs.conflict = performance.now() - conflictStart;
  if (!resolved.ok) {
    return resolved;
  }

  logProgress(policy, 'Sorting claims...');
  const sortStart = performance.now();
  const sorted = sortPreparedClaimsForJsonl(resolved.value);
  stageTimingMs.sort = performance.now() - sortStart;

  logProgress(policy, 'Emitting JSONL...');
  const jsonlStart = performance.now();
  const { jsonl, jsonlSha256 } = emitJsonlFromPrepared(sorted);
  stageTimingMs.jsonl = performance.now() - jsonlStart;

  const sortedClaims = sorted.map((entry) => entry.claim);

  logProgress(policy, 'Building leaves...');
  const leavesStart = performance.now();
  const { leaves: leafMap } = buildLeaves(sortedClaims, {
    leafCapBytes: policy.leafCapBytes,
    progress: policy.progress,
  });
  stageTimingMs.leaves = performance.now() - leavesStart;

  logProgress(policy, 'Building Merkle tree...');
  const merkleStart = performance.now();
  const orderedEntries = [...leafMap.entries()].sort(([a], [b]) => compareStrings(a, b));
  const orderedDigests = orderedEntries.map(([, v]) => v.leafHash);
  const merkle = buildMerkle(orderedDigests);
  const merkleRoot = merkle.root;

  const leaves = new Map<string, EpochLeaf>();
  for (let i = 0; i < orderedEntries.length; i++) {
    const [leafKey, entry] = orderedEntries[i];
    leaves.set(leafKey, {
      leaf: entry.canonical,
      leafHash: entry.leafHash,
      proof: merkle.proofFor(i),
    });
  }
  stageTimingMs.merkle = performance.now() - merkleStart;

  logProgress(policy, 'Compile complete');

  return {
    ok: true,
    value: {
      jsonl,
      jsonlSha256,
      merkleRoot,
      leaves,
      claimCount: sorted.length,
      byType: countByType(sortedClaims),
      stageTimingMs,
    },
  };
}
