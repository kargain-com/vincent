import { describe, expect, it } from 'vitest';

import golden from './fixtures/golden.json';
import { parseClaim } from '../../src/protocol/parse-claim.js';

const claims = golden.claims;
const validWmi = claims.wmi;
const validVdsSchema = claims.vdsSchema;
const validVdsBinding = claims.vdsBinding;
const validVds = claims.vdsPattern;
const validYear = claims.yearHint;

describe('parseClaim', () => {
  it('accepts valid wmi claim', () => {
    expect(parseClaim(validWmi)).toEqual({ ok: true, value: validWmi });
  });

  it('accepts valid vds-schema claim', () => {
    expect(parseClaim(validVdsSchema)).toEqual({ ok: true, value: validVdsSchema });
  });

  it('accepts valid vds-binding claim', () => {
    expect(parseClaim(validVdsBinding)).toEqual({ ok: true, value: validVdsBinding });
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

  it('rejects legacy contributor field', () => {
    const result = parseClaim({ ...validWmi, contributor: golden.address });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.code).toBe('unknown-key:contributor');
    }
  });

  it('rejects legacy signature field', () => {
    const result = parseClaim({ ...validWmi, signature: '0x' + '11'.repeat(65) });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.code).toBe('unknown-key:signature');
    }
  });

  it('rejects missing required keys', () => {
    const partial = { ...validWmi };
    delete (partial as { provenance?: string }).provenance;
    const result = parseClaim(partial);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.code).toBe('missing-key:provenance');
    }
  });

  it('rejects null optional fields', () => {
    expect(parseClaim({ ...validVds, evidence: null }).ok).toBe(false);
    expect(parseClaim({ ...validWmi, supersedes: null }).ok).toBe(false);
  });

  it('rejects wrong schemaVersion for wmi', () => {
    expect(parseClaim({ ...validWmi, schemaVersion: '1.1' }).ok).toBe(false);
  });

  it('rejects wrong schemaVersion for vds-pattern', () => {
    expect(parseClaim({ ...validVds, schemaVersion: '1.0' }).ok).toBe(false);
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

  it('rejects invalid supersedes hash', () => {
    expect(parseClaim({ ...validWmi, supersedes: 'sha256:abc' }).ok).toBe(false);
  });

  it('rejects empty evidence array', () => {
    expect(parseClaim({ ...validVds, evidence: [] }).ok).toBe(false);
  });

  it('rejects invalid evidence URI', () => {
    expect(parseClaim({ ...validVds, evidence: ['http://bad'] }).ok).toBe(false);
  });

  it('rejects invalid wmi key length', () => {
    expect(parseClaim({ ...validWmi, key: { wmi: 'AB' } }).ok).toBe(false);
  });

  it('accepts 6-char wmi key', () => {
    expect(parseClaim({ ...validWmi, key: { wmi: '1FA6P9' } }).ok).toBe(true);
  });

  it('rejects invalid vds-binding schema hash', () => {
    expect(
      parseClaim({
        ...validVdsBinding,
        key: { ...validVdsBinding.key, schema: 'bad' },
      }).ok,
    ).toBe(false);
  });

  it('rejects invalid vds-pattern match object', () => {
    expect(
      parseClaim({
        ...validVds,
        key: { schema: validVds.key.schema, match: 'bad' },
      }).ok,
    ).toBe(false);
  });

  it('rejects invalid year-hint cycleRule', () => {
    expect(
      parseClaim({
        ...validYear,
        value: { cycleRule: 'bad' },
      }).ok,
    ).toBe(false);
  });
});
