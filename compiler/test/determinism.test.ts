import { describe, expect, it } from 'vitest';

import { compile } from '../src/compile.js';
import { loadGenesisMiniClaims, loadGenesisMiniGolden } from './helpers.js';

describe('determinism', () => {
  it('produces byte-identical JSONL and merkleRoot across two compile runs', () => {
    const claims = loadGenesisMiniClaims();
    const golden = loadGenesisMiniGolden();

    const first = compile(claims, {});
    const second = compile(claims, {});

    expect(first.ok).toBe(true);
    expect(second.ok).toBe(true);
    if (!first.ok || !second.ok) {
      return;
    }

    expect(second.value.jsonl).toBe(first.value.jsonl);
    expect(first.value.jsonlSha256).toBe(golden.jsonlSha256);
    expect(second.value.jsonlSha256).toBe(golden.jsonlSha256);
    expect(first.value.merkleRoot).toBe(golden.merkleRoot);
    expect(second.value.merkleRoot).toBe(golden.merkleRoot);
  });
});
