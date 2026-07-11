/**
 * Generate RFC6962-style Merkle test vectors.
 * Run: pnpm --filter @kargain/vincent-compiler build && node compiler/scripts/gen-merkle-vectors.mjs
 */
import { writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { buildMerkle, foldMerkleProof } from '../dist/merkle.js';

const __dirname = dirname(fileURLToPath(import.meta.url));

/** Deterministic fake leaf digests for test vectors (not real content hashes). */
const digests = [
  'sha256:0000000000000000000000000000000000000000000000000000000000000001',
  'sha256:0000000000000000000000000000000000000000000000000000000000000002',
  'sha256:0000000000000000000000000000000000000000000000000000000000000003',
  'sha256:0000000000000000000000000000000000000000000000000000000000000004',
  'sha256:0000000000000000000000000000000000000000000000000000000000000005',
];

const cases = [
  { name: 'single-leaf', digests: digests.slice(0, 1) },
  { name: 'two-leaves', digests: digests.slice(0, 2) },
  { name: 'three-leaves-odd', digests: digests.slice(0, 3) },
  { name: 'four-leaves', digests: digests.slice(0, 4) },
  { name: 'five-leaves-odd', digests: digests.slice(0, 5) },
];

const vectors = cases.map(({ name, digests: leafDigests }) => {
  const tree = buildMerkle(leafDigests);
  const proofs = leafDigests.map((leafHash, index) => {
    const proof = tree.proofFor(index);
    const folded = foldMerkleProof(leafHash, proof);
    if (folded !== tree.root) {
      throw new Error(`proof fold mismatch for ${name} index ${String(index)}`);
    }
    return { index, leafHash, proof };
  });
  return {
    name,
    digests: leafDigests,
    root: tree.root,
    depth: tree.depth,
    proofs,
  };
});

const empty = buildMerkle([]);
vectors.unshift({
  name: 'empty-tree',
  digests: [],
  root: empty.root,
  depth: empty.depth,
  proofs: [],
});

const out = {
  scheme: {
    leaf: 'SHA256(0x00 || rawLeafDigest)',
    internal: 'SHA256(0x01 || left || right)',
    oddNode: 'carry last node up unchanged (no padding duplicate)',
  },
  vectors,
};

writeFileSync(
  join(__dirname, '../fixtures/merkle-rfc6962.json'),
  `${JSON.stringify(out, null, 2)}\n`,
);
process.stdout.write(`Wrote ${String(vectors.length)} Merkle test vectors\n`);
