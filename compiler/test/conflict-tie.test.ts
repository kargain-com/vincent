import { claimHash, signClaim } from '@kargain/vincent/protocol';
import { describe, expect, it } from 'vitest';

import { compile } from '../src/compile.js';
import { TEST_PRIVATE_KEY } from './helpers.js';

describe('same-key conflict tie', () => {
  it('reports a compiler error when anchor order ties on the same key', async () => {
    const base = {
      schemaVersion: '1.0' as const,
      type: 'wmi' as const,
      key: { wmi: 'ZZZ' },
      value: { manufacturer: 'Test', country: 'US', region: 'NA' },
      provenance: 'regulatory/us-vpic' as const,
      license: 'CC0-1.0' as const,
    };

    const first = signClaim({ ...base, value: { ...base.value, manufacturer: 'One' } }, TEST_PRIVATE_KEY);
    const second = signClaim(
      { ...base, value: { ...base.value, manufacturer: 'Two' } },
      TEST_PRIVATE_KEY,
    );

    const firstHash = claimHash(first);
    const secondHash = claimHash(second);

    const result = await compile([first, second], {
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
  it('keeps the claim with the earlier anchor order', async () => {
    const base = {
      schemaVersion: '1.0' as const,
      type: 'wmi' as const,
      key: { wmi: 'YYY' },
      value: { manufacturer: 'Test', country: 'US', region: 'NA' },
      provenance: 'regulatory/us-vpic' as const,
      license: 'CC0-1.0' as const,
    };

    const first = signClaim({ ...base, value: { ...base.value, manufacturer: 'Winner' } }, TEST_PRIVATE_KEY);
    const second = signClaim(
      { ...base, value: { ...base.value, manufacturer: 'Loser' } },
      TEST_PRIVATE_KEY,
    );

    const firstHash = claimHash(first);
    const secondHash = claimHash(second);

    const result = await compile([second, first], {
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
