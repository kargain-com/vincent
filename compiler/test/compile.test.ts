import { describe, expect, it } from 'vitest';

import { compile } from '../src/compile.js';
import { loadGenesisMiniClaims } from './helpers.js';

describe('compile validation', () => {
  it('accepts genesis-mini fact cores without per-claim signature verification', () => {
    const claims = loadGenesisMiniClaims();
    const result = compile(claims, {});
    expect(result.ok).toBe(true);
  });

  it('rejects duplicate claim hashes in input', () => {
    const claims = loadGenesisMiniClaims();
    const result = compile([claims[0], claims[0]], {});

    expect(result.ok).toBe(false);
    if (result.ok) {
      return;
    }
    expect(result.error.code).toBe('duplicate-claim');
  });

  it('rejects malformed claims', () => {
    const claims = loadGenesisMiniClaims();
    const bad = { ...claims[0], type: 'not-a-type' };
    const result = compile([bad as typeof claims[0]], {});

    expect(result.ok).toBe(false);
    if (result.ok) {
      return;
    }
    expect(result.error.code).toBe('invalid-claim-type');
  });
});

describe('compile output', () => {
  it('returns merkleRoot and self-contained per-WMI leaves with proofs', () => {
    const claims = loadGenesisMiniClaims();
    const result = compile(claims, {});

    expect(result.ok).toBe(true);
    if (!result.ok) {
      return;
    }

    expect(result.value.merkleRoot).toMatch(/^sha256:[0-9a-f]{64}$/);
    expect(result.value.leaves.size).toBeGreaterThan(0);
    for (const [leafKey, entry] of result.value.leaves) {
      expect(leafKey.length).toBeGreaterThanOrEqual(3);
      expect(entry.leafHash).toMatch(/^sha256:[0-9a-f]{64}$/);
      const parsed = JSON.parse(entry.leaf) as { wmi?: string; partitioned?: boolean };
      if (parsed.partitioned === true) {
        expect(parsed.wmi).toBe(leafKey);
      } else if (parsed.wmi !== undefined) {
        if (leafKey.includes('#')) {
          expect(leafKey.startsWith(`${parsed.wmi}#p`)).toBe(true);
        } else {
          expect(parsed.wmi).toBe(leafKey);
        }
      }
      expect(Array.isArray(entry.proof)).toBe(true);
    }
  });
});

describe('compile with fact cores', () => {
  it('accepts unsigned wmi fact cores', () => {
    const claim = {
      schemaVersion: '1.0' as const,
      type: 'wmi' as const,
      key: { wmi: 'XXX' },
      value: { manufacturer: 'Solo', country: 'US', vehicleType: null, region: 'NA' },
      provenance: 'regulatory/us-vpic' as const,
      license: 'CC0-1.0' as const,
    };

    const result = compile([claim], {});
    expect(result.ok).toBe(true);
    if (!result.ok) {
      return;
    }
    expect(result.value.claimCount).toBe(1);
    expect(result.value.jsonl).toContain('"wmi":"XXX"');
    expect(result.value.jsonl).not.toContain('"signature"');
  });
});
