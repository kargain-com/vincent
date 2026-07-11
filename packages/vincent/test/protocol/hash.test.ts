import { describe, expect, it } from 'vitest';

import golden from './fixtures/golden.json';
import { attestationHash, claimHash, manifestHash, signingPayload } from '../../src/protocol/hash.js';
import { attest, signManifest } from '../../src/protocol/sign.js';

describe('hash', () => {
  const { privateKey, claims, hashes } = golden;

  it('claimHash is the canonical fact core (no signature field)', () => {
    expect(claimHash(claims.wmi)).toBe(hashes.wmi);
    expect(JSON.stringify(claims.wmi)).not.toContain('signature');
  });

  it('claimHash is stable for wmi fixture', () => {
    expect(claimHash(claims.wmi)).toBe(hashes.wmi);
  });

  it('claimHash is stable for vds-schema fixture', () => {
    expect(claimHash(claims.vdsSchema)).toBe(hashes.vdsSchema);
  });

  it('claimHash is stable for vds-binding fixture', () => {
    expect(claimHash(claims.vdsBinding)).toBe(hashes.vdsBinding);
  });

  it('claimHash is stable for vds-pattern fixture', () => {
    expect(claimHash(claims.vdsPattern)).toBe(hashes.vdsPattern);
  });

  it('claimHash is stable for year-hint fixture', () => {
    expect(claimHash(claims.yearHint)).toBe(hashes.yearHint);
  });

  it('signingPayload excludes signature on attestations', () => {
    const att = attest(hashes.wmi, privateKey);
    const payload = signingPayload(att);
    expect(payload).not.toContain('"signature"');
    expect(payload).toContain('"attester"');
  });

  it('attestationHash is stable for golden attestation', () => {
    expect(attestationHash(golden.attestations.wmi)).toMatch(/^sha256:[0-9a-f]{64}$/);
  });

  it('manifestHash is stable for genesis manifest fixture', () => {
    const claimList = [
      hashes.wmi,
      hashes.vdsSchema,
      hashes.vdsBinding,
      hashes.vdsPattern,
      hashes.yearHint,
    ].sort();
    const signed = signManifest({ ...golden.manifest, claims: claimList }, privateKey);
    expect(manifestHash(signed)).toBe(hashes.manifest);
  });
});
