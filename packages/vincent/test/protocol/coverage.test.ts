import { describe, expect, it } from 'vitest';

import { CanonicalizeError, canonicalize } from '../../src/protocol/canonicalize.js';
import { parseClaim } from '../../src/protocol/parse-claim.js';
import { parseManifest } from '../../src/protocol/parse-manifest.js';
import { parsePositions } from '../../src/protocol/parse-utils.js';
import golden from './fixtures/golden.json';

describe('protocol coverage edges', () => {
  it('canonicalize rejects high surrogate followed by non-low surrogate', () => {
    expect(() => canonicalize({ text: '\ud800A' })).toThrow(CanonicalizeError);
  });

  it('sorts prefix property names by UTF-16 length', () => {
    expect(canonicalize({ aa: 1, a: 2 })).toBe('{"a":2,"aa":1}');
  });

  it('canonicalize rejects leading low surrogate', () => {
    expect(() => canonicalize({ text: '\ude00b' })).toThrow(CanonicalizeError);
  });

  it('canonicalize rejects undefined values', () => {
    expect(() => canonicalize(undefined)).toThrow(CanonicalizeError);
  });

  it('parses optional supersedes hash', () => {
    const result = parseClaim({
      ...golden.signed.wmi,
      supersedes: 'sha256:0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef',
    });
    expect(result.ok).toBe(true);
  });

  it('parses non-string schemaVersion as unsupported', () => {
    expect(parseClaim({ ...golden.signed.wmi, schemaVersion: 1 }).ok).toBe(false);
    expect(parseManifest({ ...golden.signed.manifest, schemaVersion: 1 }).ok).toBe(false);
  });

  it('parses unsupported minor schema versions', () => {
    expect(parseClaim({ ...golden.signed.wmi, schemaVersion: '1.1' }).ok).toBe(false);
  });

  it('parses invalid evidence container type', () => {
    expect(parseClaim({ ...golden.signed.vdsPattern, evidence: 'bad' }).ok).toBe(false);
  });

  it('parses invalid wmi character in key', () => {
    expect(parseClaim({ ...golden.signed.wmi, key: { wmi: 'VF!' } }).ok).toBe(false);
  });

  it('parses empty wmi region value', () => {
    expect(
      parseClaim({
        ...golden.signed.wmi,
        value: { manufacturer: 'Peugeot', country: 'FR', region: '' },
      }).ok,
    ).toBe(false);
  });

  it('parses empty wmi manufacturer value', () => {
    expect(
      parseClaim({
        ...golden.signed.wmi,
        value: { manufacturer: '', country: 'FR', region: 'EU' },
      }).ok,
    ).toBe(false);
  });

  it('parses empty wmi country value', () => {
    expect(
      parseClaim({
        ...golden.signed.wmi,
        value: { manufacturer: 'Peugeot', country: '', region: 'EU' },
      }).ok,
    ).toBe(false);
  });

  it('parses invalid vds key object', () => {
    expect(parseClaim({ ...golden.signed.vdsPattern, key: null }).ok).toBe(false);
  });

  it('parses unknown vds key fields', () => {
    expect(
      parseClaim({
        ...golden.signed.vdsPattern,
        key: { ...golden.signed.vdsPattern.key, extra: 'x' },
      }).ok,
    ).toBe(false);
  });

  it('parses missing vds positions key', () => {
    expect(
      parseClaim({
        ...golden.signed.vdsPattern,
        key: { wmi: 'VF3', pattern: 'LC***' },
      }).ok,
    ).toBe(false);
  });

  it('parses invalid vds key wmi code', () => {
    expect(
      parseClaim({
        ...golden.signed.vdsPattern,
        key: { ...golden.signed.vdsPattern.key, wmi: 'VF!' },
      }).ok,
    ).toBe(false);
  });

  it('parses missing year-hint cycleRule', () => {
    expect(parseClaim({ ...golden.signed.yearHint, value: {} }).ok).toBe(false);
  });

  it('parses invalid vds value object', () => {
    expect(parseClaim({ ...golden.signed.vdsPattern, value: null }).ok).toBe(false);
  });

  it('parses unknown vds value keys', () => {
    expect(
      parseClaim({
        ...golden.signed.vdsPattern,
        value: { attribute: 'model', code: '308', extra: 'x' },
      }).ok,
    ).toBe(false);
  });

  it('parses missing vds value code key', () => {
    expect(parseClaim({ ...golden.signed.vdsPattern, value: { attribute: 'model' } }).ok).toBe(
      false,
    );
  });

  it('parses unknown year-hint value keys', () => {
    expect(
      parseClaim({
        ...golden.signed.yearHint,
        value: { cycleRule: 'iso-unreliable', extra: 'x' },
      }).ok,
    ).toBe(false);
  });

  it('parses missing wmi value country key', () => {
    expect(
      parseClaim({
        ...golden.signed.wmi,
        value: { manufacturer: 'Peugeot', region: 'EU' },
      }).ok,
    ).toBe(false);
  });

  it('parses unknown wmi value keys', () => {
    expect(
      parseClaim({
        ...golden.signed.wmi,
        value: { ...golden.signed.wmi.value, extra: 'x' },
      }).ok,
    ).toBe(false);
  });

  it('parses invalid year-hint value object', () => {
    expect(parseClaim({ ...golden.signed.yearHint, value: null }).ok).toBe(false);
  });

  it('parses invalid year-hint key object', () => {
    expect(parseClaim({ ...golden.signed.yearHint, key: null }).ok).toBe(false);
  });

  it('parses invalid vds pattern type', () => {
    expect(
      parseClaim({
        ...golden.signed.vdsPattern,
        key: { ...golden.signed.vdsPattern.key, pattern: 123 },
      }).ok,
    ).toBe(false);
  });

  it('parses invalid vds code value', () => {
    expect(parseClaim({ ...golden.signed.vdsPattern, value: { attribute: 'model', code: '' } }).ok)
      .toBe(false);
  });

  it('parses missing wmi key property', () => {
    expect(parseClaim({ ...golden.signed.wmi, key: {} }).ok).toBe(false);
  });

  it('parses non-string wmi key code', () => {
    expect(parseClaim({ ...golden.signed.wmi, key: { wmi: 123 } }).ok).toBe(false);
  });

  it('parses non-string positions directly', () => {
    expect(parsePositions(4).ok).toBe(false);
  });

  it('parses inverted vds positions range', () => {
    expect(
      parseClaim({
        ...golden.signed.vdsPattern,
        key: { ...golden.signed.vdsPattern.key, positions: '8-4' },
      }).ok,
    ).toBe(false);
  });

  it('parses invalid manifest parent hash', () => {
    expect(
      parseManifest({
        ...golden.signed.manifest,
        epoch: 2,
        parent: 'sha256:abc',
      }).ok,
    ).toBe(false);
  });

  it('parses manifest with non-array claims', () => {
    expect(parseManifest({ ...golden.signed.manifest, claims: 'bad' }).ok).toBe(false);
  });

  it('parses manifest with missing dataset fields', () => {
    const dataset = {
      jsonlSha256: golden.signed.manifest.dataset.jsonlSha256,
      uris: golden.signed.manifest.dataset.uris,
    };
    expect(parseManifest({ ...golden.signed.manifest, dataset }).ok).toBe(false);
  });

  it('parses manifest with empty dataset uri entry', () => {
    expect(
      parseManifest({
        ...golden.signed.manifest,
        dataset: { ...golden.signed.manifest.dataset, uris: [''] },
      }).ok,
    ).toBe(false);
  });

  it('parses manifest with invalid reviewer address', () => {
    expect(
      parseManifest({
        ...golden.signed.manifest,
        reviewPolicy: { minAccepts: 1, reviewers: ['0x1234'] },
      }).ok,
    ).toBe(false);
  });

  it('parses reviewPolicy missing required properties', () => {
    expect(parseManifest({ ...golden.signed.manifest, reviewPolicy: { minAccepts: 1 } }).ok).toBe(
      false,
    );
  });

  it('parses manifest with invalid reviewPolicy object', () => {
    expect(parseManifest({ ...golden.signed.manifest, reviewPolicy: null }).ok).toBe(false);
  });

  it('parses manifest with invalid compiler object', () => {
    expect(parseManifest({ ...golden.signed.manifest, compiler: null }).ok).toBe(false);
  });

  it('parses invalid compiler name', () => {
    expect(
      parseManifest({
        ...golden.signed.manifest,
        compiler: { name: '', version: '1.0.0' },
      }).ok,
    ).toBe(false);
  });

  it('parses manifest with missing compiler version', () => {
    expect(
      parseManifest({
        ...golden.signed.manifest,
        compiler: { name: 'vincent-compiler' },
      }).ok,
    ).toBe(false);
  });

  it('parses invalid dataset object', () => {
    expect(parseManifest({ ...golden.signed.manifest, dataset: [] }).ok).toBe(false);
  });

  it('parses invalid dataset jsonl hash field', () => {
    expect(
      parseManifest({
        ...golden.signed.manifest,
        dataset: { ...golden.signed.manifest.dataset, jsonlSha256: '' },
      }).ok,
    ).toBe(false);
  });

  it('parses invalid dataset sqlite hash field', () => {
    expect(
      parseManifest({
        ...golden.signed.manifest,
        dataset: { ...golden.signed.manifest.dataset, sqliteSha256: '' },
      }).ok,
    ).toBe(false);
  });
});
