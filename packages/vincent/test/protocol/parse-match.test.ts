import { describe, expect, it } from 'vitest';

import { parseMatchExpression, parseMatchSegment } from '../../src/protocol/parse-match.js';

describe('parseMatchSegment', () => {
  const validVectors = ['**BB', '**C[AB]', '*G', '[0-9]A'] as const;
  const invalidVectors = ['**C[AB', 'I**', '[]', 'a*'] as const;

  for (const segment of validVectors) {
    it(`accepts valid segment ${segment}`, () => {
      const result = parseMatchSegment(segment);
      expect(result.ok).toBe(true);
    });
  }

  for (const segment of invalidVectors) {
    it(`rejects invalid segment ${segment}`, () => {
      const result = parseMatchSegment(segment);
      expect(result.ok).toBe(false);
    });
  }

  it('parses wildcard and literal tokens', () => {
    const result = parseMatchSegment('**BB');
    expect(result).toEqual({
      ok: true,
      value: [
        { kind: 'wildcard' },
        { kind: 'wildcard' },
        { kind: 'literal', char: 'B' },
        { kind: 'literal', char: 'B' },
      ],
    });
  });

  it('parses character class with listed chars', () => {
    const result = parseMatchSegment('**C[AB]');
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value[2]).toEqual({ kind: 'literal', char: 'C' });
      expect(result.value[3]).toEqual({ kind: 'class', chars: ['A', 'B'] });
    }
  });

  it('parses character class with numeric range', () => {
    const result = parseMatchSegment('[0-9]A');
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value[0]).toEqual({
        kind: 'class',
        chars: ['0', '1', '2', '3', '4', '5', '6', '7', '8', '9'],
      });
      expect(result.value[1]).toEqual({ kind: 'literal', char: 'A' });
    }
  });

  it('rejects negation in character class', () => {
    expect(parseMatchSegment('[!A]').ok).toBe(false);
    expect(parseMatchSegment('[^A]').ok).toBe(false);
  });

  it('rejects inverted character range', () => {
    expect(parseMatchSegment('[9-0]').ok).toBe(false);
  });

  it('rejects invalid range end character', () => {
    expect(parseMatchSegment('[0-a]').ok).toBe(false);
  });

  it('rejects non-string input', () => {
    expect(parseMatchSegment(123 as unknown as string).ok).toBe(false);
  });

  it('rejects empty segment', () => {
    expect(parseMatchSegment('').ok).toBe(false);
  });

  it('rejects I/O/Q as literals', () => {
    expect(parseMatchSegment('O*').ok).toBe(false);
    expect(parseMatchSegment('Q*').ok).toBe(false);
  });

  it('rejects I/O/Q inside character class', () => {
    expect(parseMatchSegment('[IO]').ok).toBe(false);
  });
});

describe('parseMatchExpression', () => {
  it('parses vds-only match', () => {
    const result = parseMatchExpression({ vds: '*G' });
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.vis).toBeUndefined();
    }
  });

  it('parses vds and vis segments', () => {
    const result = parseMatchExpression({ vds: '**BB', vis: '*G' });
    expect(result.ok).toBe(true);
  });

  it('rejects invalid vis segment', () => {
    expect(parseMatchExpression({ vds: '*G', vis: 'a*' }).ok).toBe(false);
  });
});
