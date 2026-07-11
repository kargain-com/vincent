import { matchExpression } from '@kargain/vincent/decoder';
import { describe, expect, it } from 'vitest';

import { synthesizeVin } from '../src/seed/synthesize-vin.js';

describe('synthesizeVin', () => {
  it('synthesizes VINs that match vds-only patterns', () => {
    const vin = synthesizeVin('1FA', { vds: '**BB' });
    expect(vin).toHaveLength(17);
    expect(matchExpression({ vds: '**BB' }, vin)).toBe(true);
  });

  it('synthesizes VINs with character classes', () => {
    const vin = synthesizeVin('1FA', { vds: '[1234]' });
    expect(matchExpression({ vds: '[1234]' }, vin)).toBe(true);
  });

  it('synthesizes VINs with wildcard suffix literals', () => {
    const vin = synthesizeVin('1FA', { vds: '*****', vis: '*S' });
    expect(matchExpression({ vds: '*****', vis: '*S' }, vin)).toBe(true);
  });

  it('synthesizes VINs with complex class patterns', () => {
    const vin = synthesizeVin('1FA', { vds: '[CS]CK[AC]' });
    expect(matchExpression({ vds: '[CS]CK[AC]' }, vin)).toBe(true);
  });

  it('synthesizes VINs with trailing H6-style patterns', () => {
    const vin = synthesizeVin('1FA', { vds: '***H6' });
    expect(matchExpression({ vds: '***H6' }, vin)).toBe(true);
  });

  it('synthesizes VINs with vis segments', () => {
    const vin = synthesizeVin('1FA', { vds: '**BB', vis: '*G' });
    expect(matchExpression({ vds: '**BB', vis: '*G' }, vin)).toBe(true);
  });
});
