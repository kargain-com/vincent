import { describe, expect, it } from 'vitest';

import * as decoderEntry from '../../src/decoder-export.js';
import * as decoderModule from '../../src/decoder/index.js';

describe('decoder entry re-exports', () => {
  it('exposes the public decoder API from both entry modules', () => {
    expect(typeof decoderEntry.createDecoder).toBe('function');
    expect(typeof decoderEntry.matchExpression).toBe('function');
    expect(typeof decoderModule.createDecoder).toBe('function');
    expect(typeof decoderModule.matchParsedExpression).toBe('function');
  });
});
