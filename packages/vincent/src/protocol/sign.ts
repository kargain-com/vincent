import { addressFromPrivateKey, signPersonalMessage, toChecksumAddress } from './crypto.js';
import { signingPayload } from './hash.js';
import type { Attestation, AttestationKind, Manifest, UnsignedManifest } from './types.js';

/** Create a signed attestation endorsing a claim id (§4.9). */
export function attest(
  claimId: string,
  privateKey: string,
  kind: AttestationKind = 'endorse',
): Attestation {
  const attester = toChecksumAddress(addressFromPrivateKey(privateKey));
  const unsigned = {
    schemaVersion: '1.0' as const,
    claim: claimId,
    attester,
    kind,
  };
  const payload = signingPayload(unsigned);
  const signature = signPersonalMessage(payload, privateKey);
  return { ...unsigned, signature };
}

/** Sign a manifest with EIP-191 personal_sign; sets publisher and signature. */
export function signManifest(manifest: UnsignedManifest, privateKey: string): Manifest {
  const publisher = toChecksumAddress(addressFromPrivateKey(privateKey));
  const unsigned = { ...manifest, publisher };
  const payload = signingPayload(unsigned);
  const signature = signPersonalMessage(payload, privateKey);
  return { ...unsigned, signature };
}
