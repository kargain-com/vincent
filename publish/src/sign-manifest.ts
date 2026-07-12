import {
  manifestHash as protocolManifestHash,
  signManifest as protocolSignManifest,
  verifyManifest,
} from '@kargain/vincent/protocol';
import type { Manifest, UnsignedManifest } from '@kargain/vincent/protocol';

import type { ManifestVerifyResult, SignedManifest } from './types.js';

/** Sign an unsigned manifest with EIP-191 personal_sign; sets publisher and signature. */
export function signManifest(unsigned: UnsignedManifest, privateKeyHex: string): SignedManifest {
  return protocolSignManifest(unsigned, privateKeyHex);
}

/** SHA-256 content id of the signed manifest canonical form (includes signature). */
export function manifestHash(signed: SignedManifest): string {
  return protocolManifestHash(signed);
}

/** Verify manifest signature; returns recovered publisher on success. */
export function verifySignedManifest(signed: Manifest): ManifestVerifyResult {
  const result = verifyManifest(signed);
  if (!result.ok) {
    return result;
  }
  return { ok: true, publisher: signed.publisher };
}
