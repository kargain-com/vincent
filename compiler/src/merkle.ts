/**
 * RFC 6962–style Merkle tree over leaf content digests.
 *
 * Domain separation (second-preimage resistant):
 *   leaf node     = SHA256(0x00 || rawLeafDigest)
 *   internal node = SHA256(0x01 || left || right)
 *
 * Odd-node rule: when a level has an odd number of nodes, the last node is
 * carried up to the next level unchanged (no padding duplicate).
 *
 * Leaf digests are ordered by WMI (caller responsibility). Each digest is a
 * `sha256:<hex>` content hash of the canonical leaf JSON.
 */

import { sha256Hex } from '@kargain/vincent/protocol';

/** Sibling hash with side relative to the proved path node. */
export type MerkleProof = Array<{ hash: string; side: 'left' | 'right' }>;

export interface BuildMerkleResult {
  root: string;
  depth: number;
  proofFor(index: number): MerkleProof;
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

function parseDigest(hash: string): Uint8Array {
  const hex = hash.startsWith('sha256:') ? hash.slice('sha256:'.length) : hash;
  if (!/^[0-9a-f]{64}$/.test(hex)) {
    throw new Error(`invalid leaf digest: ${hash}`);
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

/**
 * Build a Merkle tree over ordered leaf digests.
 * Empty input yields SHA256(0x00 || 32 zero bytes).
 */
export function buildMerkle(orderedLeafDigests: readonly string[]): BuildMerkleResult {
  if (orderedLeafDigests.length === 0) {
    const emptyLeaf = hashLeafNode(new Uint8Array(32));
    return {
      root: formatDigest(emptyLeaf),
      depth: 0,
      proofFor() {
        throw new Error('no leaves in Merkle tree');
      },
    };
  }

  // levels[0] = leaf nodes; levels[last] = [root]
  const levels: Uint8Array[][] = [];
  const leafNodes = orderedLeafDigests.map((digest) => hashLeafNode(parseDigest(digest)));
  levels.push(leafNodes);

  while (levels[levels.length - 1].length > 1) {
    const current = levels[levels.length - 1];
    const next: Uint8Array[] = [];
    for (let i = 0; i + 1 < current.length; i += 2) {
      next.push(hashInternalNode(current[i], current[i + 1]));
    }
    // Odd-node rule: carry last node up unchanged.
    if (current.length % 2 === 1) {
      next.push(current[current.length - 1]);
    }
    levels.push(next);
  }

  const rootBytes = levels[levels.length - 1][0];
  const depth = levels.length - 1;

  function proofFor(index: number): MerkleProof {
    if (index < 0 || index >= leafNodes.length) {
      throw new Error(`leaf index out of range: ${index}`);
    }

    const proof: MerkleProof = [];
    let idx = index;
    for (let level = 0; level < levels.length - 1; level++) {
      const nodes = levels[level];
      const isLastOdd = idx === nodes.length - 1 && nodes.length % 2 === 1;
      if (isLastOdd) {
        // Carried up unchanged — no sibling at this level.
        idx = Math.floor(nodes.length / 2);
        continue;
      }

      if (idx % 2 === 0) {
        proof.push({ hash: formatDigest(nodes[idx + 1]), side: 'right' });
      } else {
        proof.push({ hash: formatDigest(nodes[idx - 1]), side: 'left' });
      }
      idx = Math.floor(idx / 2);
    }
    return proof;
  }

  return {
    root: formatDigest(rootBytes),
    depth,
    proofFor,
  };
}

/** Fold a Merkle proof to a root (shared verification logic). */
export function foldMerkleProof(leafHash: string, proof: MerkleProof): string {
  let node = hashLeafNode(parseDigest(leafHash));
  for (const step of proof) {
    const sibling = parseDigest(step.hash);
    if (step.side === 'left') {
      node = hashInternalNode(sibling, node);
    } else {
      node = hashInternalNode(node, sibling);
    }
  }
  return formatDigest(node);
}
