import { describe, expect, it } from 'vitest';

import golden from './fixtures/golden.json';
import { parseManifest } from '../../src/protocol/parse-manifest.js';

const validManifest = golden.manifest;

describe('parseManifest', () => {
  it('accepts valid genesis manifest', () => {
    expect(parseManifest(validManifest)).toEqual({ ok: true, value: validManifest });
  });

  it('rejects non-object input', () => {
    expect(parseManifest([]).ok).toBe(false);
  });

  it('rejects unknown top-level keys', () => {
    expect(parseManifest({ ...validManifest, extra: true }).ok).toBe(false);
  });

  it('rejects missing required keys', () => {
    const partial = { ...validManifest };
    delete (partial as { signature?: string }).signature;
    expect(parseManifest(partial).ok).toBe(false);
  });

  it('rejects null parent', () => {
    expect(parseManifest({ ...validManifest, parent: null }).ok).toBe(false);
  });

  it('rejects unsupported schemaVersion', () => {
    expect(parseManifest({ ...validManifest, schemaVersion: '2.0' }).ok).toBe(false);
  });

  it('rejects invalid epoch', () => {
    expect(parseManifest({ ...validManifest, epoch: 0 }).ok).toBe(false);
    expect(parseManifest({ ...validManifest, epoch: 1.5 }).ok).toBe(false);
  });

  it('rejects genesis manifest with parent', () => {
    expect(
      parseManifest({
        ...validManifest,
        epoch: 1,
        parent: 'sha256:0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef',
      }).ok,
    ).toBe(false);
  });

  it('requires parent for non-genesis epoch', () => {
    const withoutParent = { ...validManifest, epoch: 2 };
    expect(parseManifest(withoutParent).ok).toBe(false);
  });

  it('accepts non-genesis manifest with parent', () => {
    const parent = 'sha256:0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef';
    expect(parseManifest({ ...validManifest, epoch: 2, parent }).ok).toBe(true);
  });

  it('rejects unsorted claims', () => {
    const claims = [...validManifest.claims].reverse();
    expect(parseManifest({ ...validManifest, claims }).ok).toBe(false);
  });

  it('rejects empty claims', () => {
    expect(parseManifest({ ...validManifest, claims: [] }).ok).toBe(false);
  });

  it('rejects invalid claim hash entries', () => {
    expect(parseManifest({ ...validManifest, claims: ['bad'] }).ok).toBe(false);
  });

  it('rejects invalid reviewPolicy', () => {
    expect(
      parseManifest({
        ...validManifest,
        reviewPolicy: { minAccepts: 0, reviewers: validManifest.reviewPolicy.reviewers },
      }).ok,
    ).toBe(false);
    expect(parseManifest({ ...validManifest, reviewPolicy: { minAccepts: 1, reviewers: [] } }).ok)
      .toBe(false);
  });

  it('rejects invalid dataset', () => {
    expect(parseManifest({ ...validManifest, dataset: { ...validManifest.dataset, uris: [] } }).ok)
      .toBe(false);
  });

  it('rejects invalid publisher and signature', () => {
    expect(parseManifest({ ...validManifest, publisher: '0x1234' }).ok).toBe(false);
    expect(parseManifest({ ...validManifest, signature: '0x1234' }).ok).toBe(false);
  });

  it('rejects invalid nested object keys', () => {
    expect(
      parseManifest({
        ...validManifest,
        reviewPolicy: { minAccepts: 1, reviewers: validManifest.reviewPolicy.reviewers, extra: true },
      }).ok,
    ).toBe(false);
    expect(
      parseManifest({
        ...validManifest,
        compiler: { ...validManifest.compiler, extra: true },
      }).ok,
    ).toBe(false);
    expect(
      parseManifest({
        ...validManifest,
        dataset: { ...validManifest.dataset, extra: true },
      }).ok,
    ).toBe(false);
  });

  it('rejects disallowed extra dataset keys', () => {
    const legacyIndexKey = ['index', 'Sha256'].join('');
    const legacyDbKey = ['sql', 'ite', 'Sha256'].join('');
    expect(
      parseManifest({
        ...validManifest,
        dataset: {
          jsonlSha256: validManifest.dataset.jsonlSha256,
          [legacyIndexKey]: validManifest.dataset.merkleRoot,
          uris: validManifest.dataset.uris,
        },
      }).ok,
    ).toBe(false);
    expect(
      parseManifest({
        ...validManifest,
        dataset: {
          ...validManifest.dataset,
          [legacyDbKey]: 'sha256:0000000000000000000000000000000000000000000000000000000000000000',
        },
      }).ok,
    ).toBe(false);
  });
});
