import { describe, expect, it } from 'vitest';

import golden from './fixtures/golden.json';
import { claimHash } from '../../src/protocol/hash.js';
import { parseClaim } from '../../src/protocol/parse-claim.js';
import { signClaim, signManifest } from '../../src/protocol/sign.js';
import { verifyClaim, verifyManifest } from '../../src/protocol/verify.js';

describe('sign and verify', () => {
  const { privateKey, address, unsigned } = golden;

  it('signs and verifies wmi claim roundtrip', () => {
    const signed = signClaim(unsigned.wmi, privateKey);
    expect(signed.contributor).toBe(address);
    expect(verifyClaim(signed)).toEqual({ ok: true });
    expect(parseClaim(signed).ok).toBe(true);
  });

  it('signs and verifies vds-schema claim roundtrip', () => {
    const signed = signClaim(unsigned.vdsSchema, privateKey);
    expect(verifyClaim(signed)).toEqual({ ok: true });
  });

  it('signs and verifies vds-binding claim roundtrip', () => {
    const signed = signClaim(unsigned.vdsBinding, privateKey);
    expect(verifyClaim(signed)).toEqual({ ok: true });
  });

  it('signs and verifies vds-pattern claim roundtrip', () => {
    const signed = signClaim(unsigned.vdsPattern, privateKey);
    expect(verifyClaim(signed)).toEqual({ ok: true });
    expect(parseClaim(signed)).toEqual({ ok: true, value: signed });
  });

  it('signs and verifies year-hint claim roundtrip', () => {
    const signed = signClaim(unsigned.yearHint, privateKey);
    expect(verifyClaim(signed)).toEqual({ ok: true });
  });

  it('signs and verifies genesis manifest roundtrip', () => {
    const wmi = signClaim(unsigned.wmi, privateKey);
    const vdsSchema = signClaim(unsigned.vdsSchema, privateKey);
    const vdsBinding = signClaim(unsigned.vdsBinding, privateKey);
    const vdsPattern = signClaim(unsigned.vdsPattern, privateKey);
    const year = signClaim(unsigned.yearHint, privateKey);
    const claims = [
      claimHash(wmi),
      claimHash(vdsSchema),
      claimHash(vdsBinding),
      claimHash(vdsPattern),
      claimHash(year),
    ].sort();
    const signed = signManifest({ ...unsigned.manifest, claims }, privateKey);
    expect(signed.publisher).toBe(address);
    expect(verifyManifest(signed)).toEqual({ ok: true });
  });

  it('rejects tampered signing payload (one byte)', () => {
    const signed = signClaim(unsigned.wmi, privateKey);
    const tampered = {
      ...signed,
      value: { ...signed.value, region: 'EUX' },
    };
    expect(verifyClaim(tampered)).toEqual({ ok: false, reason: 'address-mismatch' });
  });

  it('rejects wrong contributor address', () => {
    const signed = signClaim(unsigned.wmi, privateKey);
    const wrong = {
      ...signed,
      contributor: '0xAb00000000000000000000000000000000000001',
    };
    expect(verifyClaim(wrong)).toEqual({ ok: false, reason: 'invalid-checksum' });
  });

  it('rejects wrong publisher address on manifest', () => {
    const wmi = signClaim(unsigned.wmi, privateKey);
    const claims = [claimHash(wmi)];
    const signed = signManifest({ ...unsigned.manifest, claims }, privateKey);
    const wrong = {
      ...signed,
      publisher: '0xAb00000000000000000000000000000000000001',
    };
    expect(verifyManifest(wrong)).toEqual({ ok: false, reason: 'invalid-checksum' });
  });

  it('rejects invalid signature bytes', () => {
    const signed = signClaim(unsigned.wmi, privateKey);
    const bad = { ...signed, signature: `0x${'11'.repeat(65)}` };
    expect(verifyClaim(bad)).toEqual({ ok: false, reason: 'invalid-signature' });
  });
});
