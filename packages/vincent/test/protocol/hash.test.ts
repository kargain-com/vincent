import { describe, expect, it } from 'vitest';

import golden from './fixtures/golden.json';
import { claimHash, manifestHash, signingPayload } from '../../src/protocol/hash.js';
import { signClaim, signManifest } from '../../src/protocol/sign.js';

describe('hash', () => {
  const { privateKey, unsigned, hashes } = golden;

  it('signingPayload excludes signature field', () => {
    const signed = signClaim(unsigned.wmi, privateKey);
    const payload = signingPayload(signed);
    expect(payload).not.toContain('"signature"');
    expect(payload).toContain('"contributor"');
  });

  it('claimHash is stable for wmi fixture', () => {
    const signed = signClaim(unsigned.wmi, privateKey);
    expect(claimHash(signed)).toBe(hashes.wmi);
  });

  it('claimHash is stable for vds-pattern fixture', () => {
    const signed = signClaim(unsigned.vdsPattern, privateKey);
    expect(claimHash(signed)).toBe(hashes.vdsPattern);
  });

  it('claimHash is stable for year-hint fixture', () => {
    const signed = signClaim(unsigned.yearHint, privateKey);
    expect(claimHash(signed)).toBe(hashes.yearHint);
  });

  it('manifestHash is stable for genesis manifest fixture', () => {
    const wmi = signClaim(unsigned.wmi, privateKey);
    const vds = signClaim(unsigned.vdsPattern, privateKey);
    const year = signClaim(unsigned.yearHint, privateKey);
    const claims = [claimHash(wmi), claimHash(vds), claimHash(year)].sort();
    const signed = signManifest({ ...unsigned.manifest, claims }, privateKey);
    expect(manifestHash(signed)).toBe(hashes.manifest);
  });
});
