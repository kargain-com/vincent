import { addressFromPrivateKey, signPersonalMessage } from './crypto.js';
import { signingPayload } from './hash.js';
import type { Claim, Manifest, UnsignedClaim, UnsignedManifest } from './types.js';

/** Sign a claim with EIP-191 personal_sign; sets contributor and signature. */
export function signClaim(claim: UnsignedClaim, privateKey: string): Claim {
  const contributor = addressFromPrivateKey(privateKey);
  const unsigned = { ...claim, contributor };
  const payload = signingPayload(unsigned);
  const signature = signPersonalMessage(payload, privateKey);
  return { ...unsigned, signature } as Claim;
}

/** Sign a manifest with EIP-191 personal_sign; sets publisher and signature. */
export function signManifest(manifest: UnsignedManifest, privateKey: string): Manifest {
  const publisher = addressFromPrivateKey(privateKey);
  const unsigned = { ...manifest, publisher };
  const payload = signingPayload(unsigned);
  const signature = signPersonalMessage(payload, privateKey);
  return { ...unsigned, signature };
}
