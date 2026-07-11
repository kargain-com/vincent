import { canonicalize } from './canonicalize.js';
import { sha256Hex } from './crypto.js';
import type { Claim, Manifest, UnsignedClaim, UnsignedManifest } from './types.js';

type HashableDocument = Claim | Manifest | UnsignedClaim | UnsignedManifest;

function utf8Bytes(value: string): Uint8Array {
  return new TextEncoder().encode(value);
}

/** Canonical form excluding the signature field (signing payload per §3). */
export function signingPayload(doc: HashableDocument): string {
  const rest = { ...doc } as Record<string, unknown>;
  delete rest.signature;
  return canonicalize(rest);
}

/** SHA-256 content id of a signed claim including signature (§3). */
export function claimHash(claim: Claim): string {
  return `sha256:${sha256Hex(utf8Bytes(canonicalize(claim)))}`;
}

/** SHA-256 content id of a signed manifest including signature (§3). */
export function manifestHash(manifest: Manifest): string {
  return `sha256:${sha256Hex(utf8Bytes(canonicalize(manifest)))}`;
}
