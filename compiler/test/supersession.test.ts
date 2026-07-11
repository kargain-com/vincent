import { claimHash } from '@kargain/vincent/protocol';
import { describe, expect, it } from 'vitest';

import { compile } from '../src/compile.js';
import { loadGenesisMiniClaims } from './helpers.js';

describe('supersession', () => {
  it('removes superseded claim from compiled output', () => {
    const claims = loadGenesisMiniClaims();
    const result = compile(claims, {});

    expect(result.ok).toBe(true);
    if (!result.ok) {
      return;
    }

    const superseded = claims.find(
      (c) => c.type === 'vds-pattern' && c.value.code === 'Fusion-OLD',
    );
    expect(superseded).toBeDefined();

    const supersededHash = claimHash(superseded!);
    expect(result.value.jsonl).not.toContain('"code":"Fusion-OLD"');
    expect(result.value.jsonl).toContain('"code":"Fusion"');
    expect(result.value.jsonl).toContain(`"supersedes":"${supersededHash}"`);
    expect(result.value.claimCount).toBe(claims.length - 1);
  });
});
