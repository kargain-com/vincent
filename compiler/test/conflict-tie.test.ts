import { claimHash } from '@kargain/vincent/protocol';
import { describe, expect, it } from 'vitest';

import { compile } from '../src/compile.js';

describe('same-key conflict tie', () => {
  it('reports a compiler error when anchor order ties on the same key', () => {
    const base = {
      schemaVersion: '1.0' as const,
      type: 'wmi' as const,
      key: { wmi: 'ZZZ' },
      value: { manufacturer: 'Test', country: 'US', vehicleType: 'Passenger Car', region: 'NA' },
      provenance: 'regulatory/us-vpic' as const,
      license: 'CC0-1.0' as const,
    };

    const first = { ...base, value: { ...base.value, manufacturer: 'One' } };
    const second = { ...base, value: { ...base.value, manufacturer: 'Two' } };

    const firstHash = claimHash(first);
    const secondHash = claimHash(second);

    const result = compile([first, second], {
      anchorRank: { [firstHash]: 0, [secondHash]: 0 },
    });

    expect(result.ok).toBe(false);
    if (result.ok) {
      return;
    }
    expect(result.error.code).toBe('conflict-tie');
  });
});

describe('same-key conflict resolution', () => {
  it('keeps the claim with the earlier anchor order', () => {
    const base = {
      schemaVersion: '1.0' as const,
      type: 'wmi' as const,
      key: { wmi: 'YYY' },
      value: { manufacturer: 'Test', country: 'US', vehicleType: 'Passenger Car', region: 'NA' },
      provenance: 'regulatory/us-vpic' as const,
      license: 'CC0-1.0' as const,
    };

    const first = { ...base, value: { ...base.value, manufacturer: 'Winner' } };
    const second = { ...base, value: { ...base.value, manufacturer: 'Loser' } };

    const firstHash = claimHash(first);
    const secondHash = claimHash(second);

    const result = compile([second, first], {
      anchorOrder: [firstHash, secondHash],
    });

    expect(result.ok).toBe(true);
    if (!result.ok) {
      return;
    }

    expect(result.value.jsonl).toContain('"manufacturer":"Winner"');
    expect(result.value.jsonl).not.toContain('"manufacturer":"Loser"');
    expect(result.value.claimCount).toBe(1);
  });
});
