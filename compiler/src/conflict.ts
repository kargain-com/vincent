import type { Claim } from '@kargain/vincent/protocol';

import type { PreparedClaim } from './prepared-claim.js';
import { fail, type CompileResult } from './types.js';

/** Deterministic conflict key per claim type (§7.2 same-key). */
export function conflictKey(claim: Claim): string {
  switch (claim.type) {
    case 'wmi':
      return `wmi:${claim.key.wmi}`;
    case 'vds-schema':
      return `vds-schema:${claim.key.name}`;
    case 'vds-binding': {
      const yearTo = claim.key.yearTo === null ? 'null' : String(claim.key.yearTo);
      return `vds-binding:${claim.key.wmi}:${claim.key.yearFrom}:${yearTo}:${claim.key.schema}`;
    }
    case 'vds-pattern': {
      const vis = claim.key.match.vis ?? '';
      return `vds-pattern:${claim.key.schema}:${claim.key.match.vds}:${vis}:${claim.value.attribute}`;
    }
    case 'year-hint':
      return `year-hint:${claim.key.wmi}`;
  }
}

/** Resolve same-key conflicts by anchor order; ties are errors. */
export function resolveConflicts(
  prepared: PreparedClaim[],
  anchorIndex: Map<string, number>,
): CompileResult<PreparedClaim[]> {
  const groups = new Map<string, PreparedClaim[]>();

  for (const entry of prepared) {
    const key = conflictKey(entry.claim);
    const group = groups.get(key);
    if (group === undefined) {
      groups.set(key, [entry]);
    } else {
      group.push(entry);
    }
  }

  const survivors: PreparedClaim[] = [];

  for (const group of groups.values()) {
    if (group.length === 1) {
      survivors.push(group[0]);
      continue;
    }

    let best: PreparedClaim | undefined;
    let bestAnchor: number | undefined;

    for (const entry of group) {
      const anchor = anchorIndex.get(entry.hash);
      if (anchor === undefined) {
        return fail('missing-anchor', `no anchor order for claim ${entry.hash}`);
      }

      if (best === undefined) {
        best = entry;
        bestAnchor = anchor;
        continue;
      }

      if (anchor < bestAnchor!) {
        best = entry;
        bestAnchor = anchor;
        continue;
      }

      if (anchor === bestAnchor) {
        return fail(
          'conflict-tie',
          `same-key conflict tie for ${conflictKey(entry.claim)} at anchor order ${anchor}`,
        );
      }
    }

    survivors.push(best!);
  }

  return { ok: true, value: survivors };
}
