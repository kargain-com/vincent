import { recoverPersonalSignAddress } from './crypto.js';
import { isValidChecksumAddress } from './eip55.js';
import { signingPayload } from './hash.js';
import type { Attestation, AttestationVerifyResult, Manifest, VerifyResult } from './types.js';

function verifySignedDocument(
  statedAddress: string,
  signature: string,
  payload: string,
): VerifyResult {
  if (!isValidChecksumAddress(statedAddress)) {
    return { ok: false, reason: 'invalid-checksum' };
  }
  let recovered: string;
  try {
    recovered = recoverPersonalSignAddress(payload, signature);
  } catch {
    return { ok: false, reason: 'invalid-signature' };
  }
  if (recovered !== statedAddress) {
    return { ok: false, reason: 'address-mismatch' };
  }
  return { ok: true };
}

/** Verify attestation signature; recovered address must equal attester (§4.9). */
export function verifyAttestation(attestation: Attestation): AttestationVerifyResult {
  const verified = verifySignedDocument(
    attestation.attester,
    attestation.signature,
    signingPayload(attestation),
  );
  if (!verified.ok) {
    return verified;
  }
  return { ok: true, attester: attestation.attester };
}

/** Verify manifest signature and publisher address (§5). */
export function verifyManifest(manifest: Manifest): VerifyResult {
  return verifySignedDocument(
    manifest.publisher,
    manifest.signature,
    signingPayload(manifest),
  );
}
