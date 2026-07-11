import { describe, expect, it } from 'vitest';

import { compile } from '../src/compile.js';
import { contentSha256 } from '../src/hash-content.js';
import { buildLeaves } from '../src/leaves.js';
import { loadGenesisMiniClaims, loadGenesisMiniGolden } from './helpers.js';

describe('leaf determinism', () => {
  it('produces byte-identical leaves across two compile runs', () => {
    const claims = loadGenesisMiniClaims();
    const first = compile(claims, {});
    const second = compile(claims, {});

    expect(first.ok).toBe(true);
    expect(second.ok).toBe(true);
    if (!first.ok || !second.ok) {
      return;
    }

    expect(first.value.leaves.size).toBe(second.value.leaves.size);
    for (const [wmi, entry] of first.value.leaves) {
      const other = second.value.leaves.get(wmi);
      expect(other?.leaf).toBe(entry.leaf);
      expect(other?.leafHash).toBe(entry.leafHash);
      expect(other?.proof).toEqual(entry.proof);
    }
    expect(first.value.merkleRoot).toBe(second.value.merkleRoot);
  });

  it('matches committed genesis-mini leaf hash', () => {
    const claims = loadGenesisMiniClaims();
    const golden = loadGenesisMiniGolden();
    const result = compile(claims, {});
    expect(result.ok).toBe(true);
    if (!result.ok) {
      return;
    }
    const entry = result.value.leaves.get(golden.sampleLeafWmi);
    expect(entry?.leafHash).toBe(golden.sampleLeafHash);
    expect(result.value.merkleRoot).toBe(golden.merkleRoot);
  });

  it('inlines schemas into self-contained leaves', () => {
    const claims = loadGenesisMiniClaims();
    const { leaves } = buildLeaves(claims);

    const entry = leaves.get('1FA');
    expect(entry).toBeDefined();
    if (entry === undefined) {
      return;
    }

    const parsed = JSON.parse(entry.canonical) as {
      wmi: string;
      bindings: Array<Record<string, unknown>>;
      schemas: Record<string, { patterns: unknown[] }>;
    };
    const bindingKeys = new Set(['yearFrom', 'yearTo', 'schemaRef']);
    expect(parsed.wmi).toBe('1FA');
    expect(parsed.bindings.length).toBeGreaterThan(0);
    for (const binding of parsed.bindings) {
      for (const key of Object.keys(binding)) {
        expect(bindingKeys.has(key)).toBe(true);
      }
      expect(parsed.schemas[binding.schemaRef as string]).toBeDefined();
      expect(parsed.schemas[binding.schemaRef as string].patterns.length).toBeGreaterThan(0);
    }
  });

  it('content-addresses leaves by canonical bytes', () => {
    const claims = loadGenesisMiniClaims();
    const { leaves } = buildLeaves(claims);

    for (const entry of leaves.values()) {
      expect(contentSha256(entry.canonical)).toBe(entry.leafHash);
    }
  });

  it('includes empty-binding WMI leaves', () => {
    const claims = loadGenesisMiniClaims();
    const { leaves } = buildLeaves(claims);
    const vf3 = leaves.get('VF3');
    expect(vf3).toBeDefined();
    if (vf3 === undefined) {
      return;
    }
    const parsed = JSON.parse(vf3.canonical) as { bindings: unknown[]; schemas: object };
    expect(parsed.bindings).toEqual([]);
    expect(parsed.schemas).toEqual({});
  });
});
