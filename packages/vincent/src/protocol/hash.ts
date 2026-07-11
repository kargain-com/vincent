import { canonicalize } from './canonicalize.js';
import { sha256Hex } from './crypto.js';
import type { Attestation, Claim, Manifest, UnsignedAttestation, UnsignedManifest } from './types.js';

type SignedDocument = Manifest | Attestation;
type SignableDocument = SignedDocument | UnsignedManifest | UnsignedAttestation;

function utf8Bytes(value: string): Uint8Array {
  return new TextEncoder().encode(value);
}

/** Canonical form excluding the signature field (manifests and attestations per §3). */
export function signingPayload(doc: SignableDocument): string {
  const rest = { ...doc } as Record<string, unknown>;
  delete rest.signature;
  return canonicalize(rest);
}

/** SHA-256 content id of a claim fact core (§3). */
export function claimHash(claim: Claim): string {
  return `sha256:${sha256Hex(utf8Bytes(canonicalize(claim)))}`;
}

/** SHA-256 content id of a signed manifest including signature (§3). */
export function manifestHash(manifest: Manifest): string {
  return `sha256:${sha256Hex(utf8Bytes(canonicalize(manifest)))}`;
}

/** SHA-256 content id of a signed attestation including signature (§3). */
export function attestationHash(attestation: Attestation): string {
  return `sha256:${sha256Hex(utf8Bytes(canonicalize(attestation)))}`;
}
