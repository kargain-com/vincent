import { describe, expect, it } from 'vitest';

import { compile } from '@kargain/vincent-compiler';

import { createDecoder } from '../../src/decoder/create-decoder.js';
import { loadGenesisMiniClaims, VIN_2011 } from './helpers.js';

describe('createDecoder', () => {
  it('returns a decoder with sync decode()', async () => {
    const built = await compile(loadGenesisMiniClaims(), {});
    expect(built.ok).toBe(true);
    if (!built.ok) {
      return;
    }

    const decoder = await createDecoder(built.value.sqlite);
    const result = decoder.decode(VIN_2011);
    expect(result.wmi?.manufacturer).toBe('Ford');
  });
});
