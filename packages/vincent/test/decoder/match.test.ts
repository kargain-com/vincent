import { describe, expect, it } from 'vitest';

import { matchExpression, matchParsedExpression } from '../../src/decoder/match.js';
import {
  VIN_BB,
  VIN_BC,
  VIN_BD,
  VIN_BB_VIS_G,
  VIN_BB_VIS_H,
} from './helpers.js';

describe('matchExpression', () => {
  it('matches **BB on vds positions 4–7', () => {
    expect(matchExpression({ vds: '**BB' }, VIN_BB)).toBe(true);
  });

  it('matches **BC', () => {
    expect(matchExpression({ vds: '**BC' }, VIN_BC)).toBe(true);
  });

  it('rejects **BC when positions 6–7 are BB', () => {
    expect(matchExpression({ vds: '**BC' }, VIN_BB)).toBe(false);
  });

  it('matches vis *G when G is at position 11', () => {
    expect(matchExpression({ vds: '**BB', vis: '*G' }, VIN_BB_VIS_G)).toBe(true);
  });

  it('rejects vis *G when position 11 is not G', () => {
    expect(matchExpression({ vds: '**BB', vis: '*G' }, VIN_BB_VIS_H)).toBe(false);
  });

  it('matches **B[AB] class at position 7', () => {
    expect(matchExpression({ vds: '**B[AB]' }, VIN_BB)).toBe(true);
  });

  it('rejects **B[AB] when position 7 is D', () => {
    expect(matchExpression({ vds: '**B[AB]' }, VIN_BD)).toBe(false);
  });

  it('returns false for invalid match grammar', () => {
    expect(matchExpression({ vds: 'a*' }, VIN_BB)).toBe(false);
  });

  it('returns false when vds segment exceeds VIN length', () => {
    expect(matchExpression({ vds: '**********' }, '1FA')).toBe(false);
  });

  it('matches vds-only when vis segment is omitted', () => {
    expect(matchExpression({ vds: '**BD' }, VIN_BD)).toBe(true);
  });

  it('evaluates parsed expressions without re-parsing', () => {
    expect(
      matchParsedExpression(
        { vds: [{ kind: 'wildcard' }, { kind: 'wildcard' }, { kind: 'literal', char: 'B' }, { kind: 'literal', char: 'B' }] },
        VIN_BB,
      ),
    ).toBe(true);
  });
});
