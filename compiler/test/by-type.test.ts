import { describe, expect, it } from 'vitest';

import { compile } from '../src/compile.js';
import { loadGenesisMiniClaims } from './helpers.js';

describe('byType counts', () => {
  it('reports survivor counts per claim type after supersession', () => {
    const claims = loadGenesisMiniClaims();
    const result = compile(claims, {});

    expect(result.ok).toBe(true);
    if (!result.ok) {
      return;
    }

    expect(result.value.byType).toEqual({
      wmi: 2,
      'vds-schema': 1,
      'vds-binding': 2,
      'vds-pattern': 4,
      'year-hint': 1,
    });
    expect(result.value.claimCount).toBe(10);
  });
});
