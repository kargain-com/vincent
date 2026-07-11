import { describe, expect, it } from 'vitest';

import golden from './fixtures/golden.json';
import { parseClaim } from '../../src/protocol/parse-claim.js';

const validWmi = golden.signed.wmi;
const validVdsSchema = golden.signed.vdsSchema;
const validVdsBinding = golden.signed.vdsBinding;
const validVds = golden.signed.vdsPattern;
const validYear = golden.signed.yearHint;

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

  it('rejects invalid vds-schema key', () => {
    expect(parseClaim({ ...validVdsSchema, key: { name: '' } }).ok).toBe(false);
    expect(parseClaim({ ...validVdsSchema, key: { name: 'x', extra: 'y' } }).ok).toBe(false);
  });

  it('rejects non-empty vds-schema value', () => {
    expect(parseClaim({ ...validVdsSchema, value: { reserved: true } }).ok).toBe(false);
  });

  it('rejects invalid vds-binding wmi length', () => {
    expect(parseClaim({ ...validVdsBinding, key: { ...validVdsBinding.key, wmi: 'AB' } }).ok).toBe(
      false,
    );
  });

  it('accepts 6-char binding wmi', () => {
    expect(
      parseClaim({
        ...validVdsBinding,
        key: { ...validVdsBinding.key, wmi: '1FA6P9' },
      }).ok,
    ).toBe(true);
  });

  it('accepts null yearTo for open-ended binding', () => {
    expect(
      parseClaim({
        ...validVdsBinding,
        key: { ...validVdsBinding.key, yearTo: null },
      }).ok,
    ).toBe(true);
  });

  it('rejects non-integer yearFrom', () => {
    expect(
      parseClaim({
        ...validVdsBinding,
        key: { ...validVdsBinding.key, yearFrom: 2011.5 },
      }).ok,
    ).toBe(false);
  });

  it('rejects yearFrom greater than yearTo', () => {
    expect(
      parseClaim({
        ...validVdsBinding,
        key: { ...validVdsBinding.key, yearFrom: 2012, yearTo: 2011 },
      }).ok,
    ).toBe(false);
  });

  it('rejects missing schema ref in binding', () => {
    expect(
      parseClaim({
        ...validVdsBinding,
        key: { wmi: '1FA', yearFrom: 2011, yearTo: 2011 },
      }).ok,
    ).toBe(false);
  });

  it('rejects invalid schema hash in binding', () => {
    expect(
      parseClaim({
        ...validVdsBinding,
        key: { ...validVdsBinding.key, schema: 'sha256:abc' },
      }).ok,
    ).toBe(false);
  });

  it('rejects invalid vds-pattern match segments', () => {
    expect(
      parseClaim({
        ...validVds,
        key: { ...validVds.key, match: { vds: '**C[AB', vis: '*G' } },
      }).ok,
    ).toBe(false);
    expect(
      parseClaim({
        ...validVds,
        key: { ...validVds.key, match: { vds: 'I**' } },
      }).ok,
    ).toBe(false);
  });

  it('rejects unknown match keys', () => {
    expect(
      parseClaim({
        ...validVds,
        key: {
          schema: validVds.key.schema,
          match: { vds: '*G', extra: 'x' },
        },
      }).ok,
    ).toBe(false);
  });

  it('rejects missing schema ref in vds-pattern', () => {
    expect(
      parseClaim({
        ...validVds,
        key: { match: { vds: '*G' } },
      }).ok,
    ).toBe(false);
  });

  it('accepts well-formed unknown attribute names', () => {
    expect(
      parseClaim({
        ...validVds,
        value: { attribute: 'customAttr', code: 'X' },
      }).ok,
    ).toBe(true);
  });

  it('rejects invalid attribute format', () => {
    expect(parseClaim({ ...validVds, value: { attribute: 'Model', code: '308' } }).ok).toBe(false);
    expect(parseClaim({ ...validVds, value: { attribute: 'bad-format', code: '308' } }).ok).toBe(
      false,
    );
    expect(parseClaim({ ...validVds, value: { attribute: '', code: '308' } }).ok).toBe(false);
  });

  it('rejects invalid cycleRule', () => {
    expect(parseClaim({ ...validYear, value: { cycleRule: 'custom' } }).ok).toBe(false);
  });

  it('rejects non-object key and value', () => {
    expect(parseClaim({ ...validWmi, key: 'VF3' }).ok).toBe(false);
    expect(parseClaim({ ...validWmi, value: 'bad' }).ok).toBe(false);
  });
});
