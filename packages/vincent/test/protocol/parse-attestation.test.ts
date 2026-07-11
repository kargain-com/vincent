import { describe, expect, it } from 'vitest';

import golden from './fixtures/golden.json';
import { parseAttestation } from '../../src/protocol/parse-attestation.js';
import { attest } from '../../src/protocol/sign.js';

describe('parseAttestation', () => {
  const { privateKey, claims, attestations } = golden;
  const valid = attestations.wmi;

  it('accepts valid attestation', () => {
    expect(parseAttestation(valid)).toEqual({ ok: true, value: valid });
  });

  it('accepts freshly attested claim', () => {
    const att = attest(golden.hashes.wmi, privateKey);
    expect(parseAttestation(att).ok).toBe(true);
  });

  it('rejects non-object input', () => {
    expect(parseAttestation(null).ok).toBe(false);
  });

  it('rejects unknown top-level keys', () => {
    expect(parseAttestation({ ...valid, extra: true }).ok).toBe(false);
  });

  it('rejects missing required keys', () => {
    const partial = { ...valid };
    delete (partial as { signature?: string }).signature;
    expect(parseAttestation(partial).ok).toBe(false);
  });

  it('rejects invalid claim hash', () => {
    expect(parseAttestation({ ...valid, claim: 'bad' }).ok).toBe(false);
  });

  it('rejects invalid attester address', () => {
    expect(parseAttestation({ ...valid, attester: 'not-an-address' }).ok).toBe(false);
  });

  it('rejects invalid kind', () => {
    expect(parseAttestation({ ...valid, kind: 'reject' }).ok).toBe(false);
  });

  it('rejects invalid signature', () => {
    expect(parseAttestation({ ...valid, signature: '0x1234' }).ok).toBe(false);
  });

  it('rejects wrong schemaVersion', () => {
    expect(parseAttestation({ ...valid, schemaVersion: '2.0' }).ok).toBe(false);
  });

  it('references an existing claim hash in golden fixture', () => {
    expect(valid.claim).toBe(golden.hashes.wmi);
    expect(parseAttestation(attestations.vdsPattern).ok).toBe(true);
    expect(attestations.vdsPattern.claim).toBe(golden.hashes.vdsPattern);
    expect(claims.vdsPattern.type).toBe('vds-pattern');
  });
});
