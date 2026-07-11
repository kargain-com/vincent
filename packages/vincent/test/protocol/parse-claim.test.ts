import { describe, expect, it } from 'vitest';

import golden from './fixtures/golden.json';
import { parseClaim } from '../../src/protocol/parse-claim.js';

const validWmi = golden.signed.wmi;
const validVds = golden.signed.vdsPattern;
const validYear = golden.signed.yearHint;

describe('parseClaim', () => {
  it('accepts valid wmi claim', () => {
    expect(parseClaim(validWmi)).toEqual({ ok: true, value: validWmi });
  });

  it('accepts valid vds-pattern claim', () => {
    expect(parseClaim(validVds)).toEqual({ ok: true, value: validVds });
  });

  it('accepts valid year-hint claim', () => {
    expect(parseClaim(validYear)).toEqual({ ok: true, value: validYear });
  });

  it('rejects non-object input', () => {
    expect(parseClaim(null).ok).toBe(false);
    expect(parseClaim('claim').ok).toBe(false);
  });

  it('rejects unknown top-level keys', () => {
    const result = parseClaim({ ...validWmi, extra: true });
    expect(result).toEqual({
      ok: false,
      error: { code: 'unknown-key:extra', message: 'Unknown top-level key: extra' },
    });
  });

  it('rejects missing required keys', () => {
    const partial = { ...validWmi };
    delete (partial as { signature?: string }).signature;
    const result = parseClaim(partial);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.code).toBe('missing-key:signature');
    }
  });

  it('rejects null optional fields', () => {
    expect(parseClaim({ ...validVds, evidence: null }).ok).toBe(false);
    expect(parseClaim({ ...validWmi, supersedes: null }).ok).toBe(false);
  });

  it('rejects unsupported schemaVersion', () => {
    expect(parseClaim({ ...validWmi, schemaVersion: '1.1' }).ok).toBe(false);
  });

  it('rejects unsupported schema major version', () => {
    expect(parseClaim({ ...validWmi, schemaVersion: '2.0' }).ok).toBe(false);
  });

  it('rejects invalid license', () => {
    expect(parseClaim({ ...validWmi, license: 'MIT' }).ok).toBe(false);
  });

  it('rejects invalid claim type', () => {
    expect(parseClaim({ ...validWmi, type: 'unknown' }).ok).toBe(false);
  });

  it('rejects invalid provenance', () => {
    expect(parseClaim({ ...validWmi, provenance: 'unknown/source' }).ok).toBe(false);
  });

  it('rejects invalid contributor address', () => {
    expect(parseClaim({ ...validWmi, contributor: 'not-an-address' }).ok).toBe(false);
  });

  it('rejects invalid signature', () => {
    expect(parseClaim({ ...validWmi, signature: '0x1234' }).ok).toBe(false);
  });

  it('rejects invalid supersedes hash', () => {
    expect(parseClaim({ ...validWmi, supersedes: 'sha256:abc' }).ok).toBe(false);
  });

  it('rejects empty evidence array', () => {
    expect(parseClaim({ ...validVds, evidence: [] }).ok).toBe(false);
  });

  it('rejects invalid evidence URI', () => {
    expect(parseClaim({ ...validVds, evidence: ['https://example.com'] }).ok).toBe(false);
  });

  it('rejects invalid wmi key shape', () => {
    expect(parseClaim({ ...validWmi, key: { wmi: 'AB' } }).ok).toBe(false);
    expect(parseClaim({ ...validWmi, key: { wmi: 'VF3', extra: 'x' } }).ok).toBe(false);
  });

  it('rejects invalid wmi value shape', () => {
    expect(parseClaim({ ...validWmi, value: { manufacturer: '', country: 'FR', region: 'EU' } }).ok)
      .toBe(false);
  });

  it('rejects invalid vds positions', () => {
    expect(parseClaim({ ...validVds, key: { ...validVds.key, positions: '9-10' } }).ok).toBe(false);
    expect(parseClaim({ ...validVds, key: { ...validVds.key, positions: '8-4' } }).ok).toBe(false);
  });

  it('rejects invalid vds pattern', () => {
    expect(parseClaim({ ...validVds, key: { ...validVds.key, pattern: 'LC**' } }).ok).toBe(false);
    expect(parseClaim({ ...validVds, key: { ...validVds.key, pattern: 'LC**I' } }).ok).toBe(false);
  });

  it('rejects invalid vehicle attribute', () => {
    expect(parseClaim({ ...validVds, value: { attribute: 'color', code: '308' } }).ok).toBe(false);
  });

  it('rejects invalid cycleRule', () => {
    expect(parseClaim({ ...validYear, value: { cycleRule: 'custom' } }).ok).toBe(false);
  });

  it('rejects non-object key and value', () => {
    expect(parseClaim({ ...validWmi, key: 'VF3' }).ok).toBe(false);
    expect(parseClaim({ ...validWmi, value: 'bad' }).ok).toBe(false);
  });
});
