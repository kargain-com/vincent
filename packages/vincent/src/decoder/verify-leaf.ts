/**
 * Verify a self-contained leaf against an anchored Merkle root.
 *
 * RFC 6962–style domain separation (must match compiler/src/merkle.ts):
 *   leaf node     = SHA256(0x00 || rawLeafDigest)
 *   internal node = SHA256(0x01 || left || right)
 * Odd-node rule: last node of an odd level is carried up unchanged
 * (proofs omit a sibling for that step).
 */

import { canonicalize, sha256Hex } from '@kargain/vincent/protocol';

import { parseWireLeaf } from './parse-leaf.js';
import type { MerkleProof, WireLeaf } from './leaf-types.js';

function utf8Bytes(value: string): Uint8Array {
  return new TextEncoder().encode(value);
}

function bytesToString(bytes: Uint8Array): string {
  return new TextDecoder().decode(bytes);
}

function hexToBytes(hex: string): Uint8Array {
  const out = new Uint8Array(hex.length / 2);
  for (let i = 0; i < out.length; i++) {
    out[i] = parseInt(hex.slice(i * 2, i * 2 + 2), 16);
  }
  return out;
}

function bytesToHex(bytes: Uint8Array): string {
  let out = '';
  for (const byte of bytes) {
    out += byte.toString(16).padStart(2, '0');
  }
  return out;
}

function parseDigest(hash: string): Uint8Array | null {
  const hex = hash.startsWith('sha256:') ? hash.slice('sha256:'.length) : hash;
  if (!/^[0-9a-f]{64}$/.test(hex)) {
    return null;
  }
  return hexToBytes(hex);
}

function formatDigest(bytes: Uint8Array): string {
  return `sha256:${bytesToHex(bytes)}`;
}

function hashLeafNode(rawDigest: Uint8Array): Uint8Array {
  const input = new Uint8Array(1 + rawDigest.length);
  input[0] = 0x00;
  input.set(rawDigest, 1);
  return hexToBytes(sha256Hex(input));
}

function hashInternalNode(left: Uint8Array, right: Uint8Array): Uint8Array {
  const input = new Uint8Array(1 + left.length + right.length);
  input[0] = 0x01;
  input.set(left, 1);
  input.set(right, 1 + left.length);
  return hexToBytes(sha256Hex(input));
}

function foldMerkleProof(leafHash: string, proof: MerkleProof): string | null {
  const raw = parseDigest(leafHash);
  if (raw === null) {
    return null;
  }
  let node = hashLeafNode(raw);
  for (const step of proof) {
    const sibling = parseDigest(step.hash);
    if (sibling === null) {
      return null;
    }
    if (step.side !== 'left' && step.side !== 'right') {
      return null;
    }
    if (step.side === 'left') {
      node = hashInternalNode(sibling, node);
    } else {
      node = hashInternalNode(node, sibling);
    }
  }
  return formatDigest(node);
}

export type VerifyLeafResult =
  | { ok: true; leaf: WireLeaf; leafHash: string }
  | { ok: false; reason: string; code: 'leaf-hash-mismatch' | 'proof-invalid' | 'invalid-leaf' };

/**
 * Recompute leaf content hash, fold the Merkle proof, compare to merkleRoot,
 * and parse the leaf fail-closed.
 */
export function verifyLeaf(
  leafBytes: Uint8Array | string,
  proof: MerkleProof,
  merkleRoot: string,
): VerifyLeafResult {
  const text = typeof leafBytes === 'string' ? leafBytes : bytesToString(leafBytes);
  let parsed: unknown;
  try {
    parsed = JSON.parse(text) as unknown;
  } catch {
    return { ok: false, reason: 'leaf is not valid JSON', code: 'invalid-leaf' };
  }

  let canonical: string;
  try {
    canonical = canonicalize(parsed);
  } catch {
    return { ok: false, reason: 'leaf is not canonicalizable', code: 'invalid-leaf' };
  }

  const leafHash = `sha256:${sha256Hex(utf8Bytes(canonical))}`;

  if (text !== canonical) {
    return {
      ok: false,
      reason: 'leaf bytes are not JCS-canonical',
      code: 'leaf-hash-mismatch',
    };
  }

  if (!Array.isArray(proof)) {
    return { ok: false, reason: 'proof must be an array', code: 'proof-invalid' };
  }

  const computedRoot = foldMerkleProof(leafHash, proof);
  if (computedRoot === null) {
    return { ok: false, reason: 'invalid proof step', code: 'proof-invalid' };
  }
  if (computedRoot !== merkleRoot) {
    return {
      ok: false,
      reason: `merkle root mismatch: expected ${merkleRoot}, got ${computedRoot}`,
      code: 'proof-invalid',
    };
  }

  const leaf = parseWireLeaf(parsed);
  if (!leaf.ok) {
    return { ok: false, reason: leaf.reason, code: 'invalid-leaf' };
  }

  return { ok: true, leaf: leaf.value, leafHash };
}

export { foldMerkleProof };
