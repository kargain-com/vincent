import { signClaim, verifyClaim } from '@kargain/vincent/protocol';
import { describe, expect, it } from 'vitest';

import { compile } from '../src/compile.js';
import { loadGenesisMiniClaims } from './helpers.js';

describe('compile validation', () => {
  it('rejects a claim with an invalid signature', async () => {
    const claims = loadGenesisMiniClaims();
    const tampered = structuredClone(claims[0]);
    tampered.value = { ...tampered.value, region: 'XX' };

    const result = await compile([tampered, ...claims.slice(1)], {});

    expect(result.ok).toBe(false);
    if (result.ok) {
      return;
    }
    expect(result.error.code).toBe('invalid-signature');
  });

  it('rejects duplicate claim hashes in input', async () => {
    const claims = loadGenesisMiniClaims();
    const result = await compile([claims[0], claims[0]], {});

    expect(result.ok).toBe(false);
    if (result.ok) {
      return;
    }
    expect(result.error.code).toBe('duplicate-claim');
  });

  it('rejects malformed claims', async () => {
    const claims = loadGenesisMiniClaims();
    const bad = { ...claims[0], type: 'not-a-type' };
    const result = await compile([bad as typeof claims[0]], {});

    expect(result.ok).toBe(false);
    if (result.ok) {
      return;
    }
    expect(result.error.code).toBe('invalid-claim-type');
  });
});

describe('compile output', () => {
  it('returns non-empty sqlite bytes and informative sqliteSha256', async () => {
    const claims = loadGenesisMiniClaims();
    const result = await compile(claims, {});

    expect(result.ok).toBe(true);
    if (!result.ok) {
      return;
    }

    expect(result.value.sqlite.byteLength).toBeGreaterThan(0);
    expect(result.value.sqliteSha256).toMatch(/^sha256:[0-9a-f]{64}$/);
  });
});

describe('compile with signed claims', () => {
  it('accepts freshly signed claims from the test key', async () => {
    const unsigned = {
      schemaVersion: '1.0' as const,
      type: 'wmi' as const,
      key: { wmi: 'XXX' },
      value: { manufacturer: 'Solo', country: 'US', region: 'NA' },
      provenance: 'regulatory/us-vpic' as const,
      license: 'CC0-1.0' as const,
    };
    const signed = signClaim(unsigned, '0xac0974bec39a17e36ba4a6b4d238ff944bacb478cab039431e99c5825582831');
    expect(verifyClaim(signed)).toEqual({ ok: true });

    const result = await compile([signed], {});
    expect(result.ok).toBe(true);
    if (!result.ok) {
      return;
    }
    expect(result.value.claimCount).toBe(1);
    expect(result.value.jsonl).toContain('"wmi":"XXX"');
    expect(result.value.jsonl).toContain('"manufacturer":"Solo"');
  });
});
