import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { describe, expect, it } from 'vitest';

import sortingFixture from './fixtures/jcs/sorting.json';
import numbersFixture from './fixtures/jcs/numbers.json';
import primitivesFixture from './fixtures/jcs/primitives.json';
import { canonicalize, CanonicalizeError } from '../../src/protocol/canonicalize.js';

const __dirname = dirname(fileURLToPath(import.meta.url));

describe('canonicalize (RFC 8785)', () => {
  it('sorts object keys per §3.2.3 test vector', () => {
    const result = canonicalize(sortingFixture.input);
    const positions = sortingFixture.expectedValueOrder.map((value) => {
      const index = result.indexOf(JSON.stringify(value));
      expect(index).toBeGreaterThan(-1);
      return index;
    });
    for (let i = 1; i < positions.length; i++) {
      expect(positions[i]).toBeGreaterThan(positions[i - 1]);
    }
  });

  it('serializes primitives per §3.2.2–3.2.4 test vector', () => {
    const result = canonicalize(primitivesFixture.input);
    const hex = [...new TextEncoder().encode(result)]
      .map((byte) => byte.toString(16).padStart(2, '0'))
      .join('');
    expect(hex).toBe(primitivesFixture.expectedHex);
    expect(JSON.parse(result)).toEqual(primitivesFixture.input);
  });

  it('serializes Appendix B number samples', () => {
    for (const sample of numbersFixture.samples) {
      const buffer = Buffer.from(sample.ieee754, 'hex');
      const value = buffer.readDoubleBE(0);
      expect(canonicalize({ n: value })).toBe(`{"n":${sample.json}}`);
    }
  });

  it('rejects NaN and Infinity', () => {
    for (const label of numbersFixture.reject) {
      const value = globalThis[label as 'NaN' | 'Infinity'];
      expect(() => canonicalize({ n: value })).toThrow(CanonicalizeError);
    }
  });

  it('rejects undefined property values', () => {
    expect(() => canonicalize({ a: undefined })).toThrow(CanonicalizeError);
  });

  it('rejects lone Unicode surrogates in strings', () => {
    expect(() => canonicalize({ a: '\ud800' })).toThrow(CanonicalizeError);
  });

  it('delegates objects with toJSON to JSON.stringify', () => {
    expect(
      canonicalize({
        a: {
          toJSON() {
            return 1;
          },
        },
      }),
    ).toBe('{"a":1}');
    expect(
      canonicalize({
        toJSON() {
          return { wrapped: true };
        },
      }),
    ).toBe('{"wrapped":true}');
  });

  it('recursively sorts nested object keys', () => {
    expect(
      canonicalize({
        z: { b: 1, a: 2 },
        a: [1, { y: 2, x: 3 }],
      }),
    ).toBe('{"a":[1,{"x":3,"y":2}],"z":{"a":2,"b":1}}');
  });
});

describe('canonicalize fixtures file integrity', () => {
  it('loads committed fixture files from disk', () => {
    const dir = join(__dirname, 'fixtures/jcs');
    expect(readFileSync(join(dir, 'sorting.json'), 'utf8')).toContain('Euro Sign');
    expect(readFileSync(join(dir, 'primitives.json'), 'utf8')).toContain('literals');
    expect(readFileSync(join(dir, 'numbers.json'), 'utf8')).toContain('ieee754');
  });
});
