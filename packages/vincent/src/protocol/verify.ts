import { recoverPersonalSignAddress } from './crypto.js';
import { isValidChecksumAddress } from './eip55.js';
import { signingPayload } from './hash.js';
import type { Claim, Manifest, VerifyResult } from './types.js';

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

/** Verify claim signature and contributor address (§5). */
export function verifyClaim(claim: Claim): VerifyResult {
  return verifySignedDocument(claim.contributor, claim.signature, signingPayload(claim));
}

/** Verify manifest signature and publisher address (§5). */
export function verifyManifest(manifest: Manifest): VerifyResult {
  return verifySignedDocument(
    manifest.publisher,
    manifest.signature,
    signingPayload(manifest),
  );
}
