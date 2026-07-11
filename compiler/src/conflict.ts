import { claimHash } from '@kargain/vincent/protocol';
import type { Claim } from '@kargain/vincent/protocol';

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
  claims: Claim[],
  anchorIndex: Map<string, number>,
): CompileResult<Claim[]> {
  const groups = new Map<string, Claim[]>();

  for (const claim of claims) {
    const key = conflictKey(claim);
    const group = groups.get(key);
    if (group === undefined) {
      groups.set(key, [claim]);
    } else {
      group.push(claim);
    }
  }

  const survivors: Claim[] = [];

  for (const group of groups.values()) {
    if (group.length === 1) {
      survivors.push(group[0]);
      continue;
    }

    let best: Claim | undefined;
    let bestAnchor: number | undefined;

    for (const claim of group) {
      const hash = claimHash(claim);
      const anchor = anchorIndex.get(hash);
      if (anchor === undefined) {
        return fail('missing-anchor', `no anchor order for claim ${hash}`);
      }

      if (best === undefined) {
        best = claim;
        bestAnchor = anchor;
        continue;
      }

      if (anchor < bestAnchor!) {
        best = claim;
        bestAnchor = anchor;
        continue;
      }

      if (anchor === bestAnchor) {
        return fail(
          'conflict-tie',
          `same-key conflict tie for ${conflictKey(claim)} at anchor order ${anchor}`,
        );
      }
    }

    survivors.push(best!);
  }

  return { ok: true, value: survivors };
}
