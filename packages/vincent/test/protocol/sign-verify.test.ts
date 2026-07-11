import { describe, expect, it } from 'vitest';

import golden from './fixtures/golden.json';
import { claimHash } from '../../src/protocol/hash.js';
import { parseAttestation } from '../../src/protocol/parse-attestation.js';
import { parseClaim } from '../../src/protocol/parse-claim.js';
import { attest, signManifest } from '../../src/protocol/sign.js';
import { verifyAttestation, verifyManifest } from '../../src/protocol/verify.js';

describe('attest and verify', () => {
  const { privateKey, address, claims, attestations, manifest } = golden;

  it('creates and verifies attestation roundtrip', () => {
    const id = claimHash(claims.wmi);
    const att = attest(id, privateKey);
    expect(att.attester).toBe(address);
    expect(verifyAttestation(att)).toEqual({ ok: true, attester: address });
    expect(parseAttestation(att).ok).toBe(true);
  });

  it('verifies committed golden attestations', () => {
    expect(verifyAttestation(attestations.wmi)).toEqual({ ok: true, attester: address });
    expect(verifyAttestation(attestations.vdsSchema)).toEqual({ ok: true, attester: address });
  });

  it('parses claim fact cores without signature fields', () => {
    expect(parseClaim(claims.wmi)).toEqual({ ok: true, value: claims.wmi });
    expect(parseClaim(claims.vdsPattern).ok).toBe(true);
  });

  it('verifies genesis manifest roundtrip', () => {
    expect(verifyManifest(manifest)).toEqual({ ok: true });
  });

  it('rejects tampered attestation payload', () => {
    const att = attest(claimHash(claims.wmi), privateKey);
    const tampered = {
      ...att,
      claim: 'sha256:0000000000000000000000000000000000000000000000000000000000000001',
    };
    expect(verifyAttestation(tampered)).toEqual({ ok: false, reason: 'address-mismatch' });
  });

  it('rejects wrong attester address', () => {
    const att = attest(claimHash(claims.wmi), privateKey);
    const wrong = {
      ...att,
      attester: '0xAb00000000000000000000000000000000000001',
    };
    expect(verifyAttestation(wrong)).toEqual({ ok: false, reason: 'invalid-checksum' });
  });

  it('rejects wrong publisher address on manifest', () => {
    const wrong = {
      ...manifest,
      publisher: '0xAb00000000000000000000000000000000000001',
    };
    expect(verifyManifest(wrong)).toEqual({ ok: false, reason: 'invalid-checksum' });
  });

  it('rejects invalid attestation signature bytes', () => {
    const att = attest(claimHash(claims.wmi), privateKey);
    const bad = { ...att, signature: `0x${'11'.repeat(65)}` };
    expect(verifyAttestation(bad)).toEqual({ ok: false, reason: 'invalid-signature' });
  });
});

describe('manifest signing', () => {
  const { privateKey, address, claims, manifest } = golden;

  it('signs manifest with publisher address', () => {
    const ids = [claimHash(claims.wmi)].sort();
    const signed = signManifest({ ...manifest, claims: ids }, privateKey);
    expect(signed.publisher).toBe(address);
    expect(verifyManifest(signed)).toEqual({ ok: true });
  });
});
