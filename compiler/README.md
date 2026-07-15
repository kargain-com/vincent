# @kargain/vincent-compiler

Epoch compiler for the Vincent protocol (P-3). Accepts an accepted claim set and produces:

- **Canonical JSONL** — normative, byte-reproducible artifact (JCS, sorted per PROTOCOL.md §7)
- **Per-WMI leaves** — self-contained JSON bundles (bindings + inlined schema patterns), content-addressed
- **Merkle root** — RFC 6962–style tree over leaf digests ordered by WMI (`merkleRoot` in manifest)

This tool does **not** parse vPIC, fetch network data, or use production signing keys.

## Package layout

| Location | Role |
|----------|------|
| `src/compile.ts` | `compile(claims, policy)` pipeline |
| `src/leaves.ts` | `buildLeaves(claims)` — deterministic per-WMI leaf JSON + hashes; `LEAF_CAP_BYTES` (128 KiB) year-range partitioning for oversized WMIs (`wmi#pN` sub-leaves + manifest at `wmi`) |
| `src/merkle.ts` | `buildMerkle(orderedLeafDigests)` — Merkle root + proofs |
| `src/verify-epoch.ts` | `verifyEpoch(manifest, claims)` rebuilt check (§6) |
| `fixtures/genesis-mini/` | Committed test claims + manifest + golden hashes + leaf files |
| `fixtures/merkle-rfc6962.json` | Committed Merkle scheme test vectors |

## Who needs this

- **Publishers** compile an accepted claim set into a byte-reproducible epoch (JSONL + leaves + Merkle root) before signing and anchoring the manifest.
- **Verifiers / confirmers** rebuild a published epoch from its claim set and check it byte-for-byte against the manifest — the §6 `rebuilt = true` check behind independent post-publication confirmations.
- **Runtime consumers do not need this package.** VIN decoding only requires `@kargain/vincent` (`./anchor`, `./arweave`, `./decoder`); clients verify Merkle proofs against the anchored root, they never compile claims.

```bash
npm install @kargain/vincent-compiler
```

Confirm an epoch:

```typescript
import { verifyEpoch } from '@kargain/vincent-compiler';

// manifest: the signed epoch manifest (e.g. fetched from its ar:// URI)
// claims:   the claim set the epoch was compiled from
const result = verifyEpoch(manifest, claims);
if (result.ok) {
  // signature valid + rebuilt jsonlSha256 and merkleRoot match manifest.dataset
} else {
  console.error(result.reason);
}
```

## API

```typescript
import { compile, verifyEpoch, buildLeaves, buildMerkle } from '@kargain/vincent-compiler';
import type { CompilePolicy, EpochBuild } from '@kargain/vincent-compiler';
```

### `compile(claims, policy?)`

1. Validates each claim (`parseClaim` well-formedness only; no per-claim signatures)
2. Applies supersession: claim B with `supersedes: A` removes A when both are present
3. Resolves same-key conflicts by anchor order (§7.2); ties → compiler error
4. Emits sorted canonical JSONL, per-WMI leaves, and Merkle root + proofs

Returns `{ ok: true, value: EpochBuild }` or `{ ok: false, error }`.

**`EpochBuild`:** `{ jsonl, jsonlSha256, merkleRoot, leaves, claimCount, byType, stageTimingMs }`

where `leaves` is `Map<leafKey, { leaf, leafHash, proof }>` (`leafKey` is `wmi` or `wmi#pN` for sub-leaves; partitioned WMIs also have a manifest at `wmi`).

### `verifyEpoch(manifest, claims)`

1. Verifies manifest signature (fail-closed)
2. **Inline claims** (`manifest.claims` present): compiles manifest-listed claims using `manifest.claims` as anchor order
3. **Claims omitted** (genesis / large epoch): compiles the provided claim set directly via `compile(claims, {})`
4. Compares rebuilt `jsonlSha256` and `merkleRoot` to `manifest.dataset`

This is the §6 **`rebuilt = true`** byte-reproducibility check.

## Merkle scheme

Domain-separated, second-preimage-resistant (RFC 6962 style):

- Leaf node: `SHA256(0x00 || rawLeafDigest)`
- Internal node: `SHA256(0x01 || left || right)`
- Odd-node rule: last node of an odd level is carried up **unchanged** (no padding duplicate)

See `fixtures/merkle-rfc6962.json` for committed test vectors.

## Fixtures

Golden hashes in `fixtures/genesis-mini/golden.json` (`jsonlSha256`, `merkleRoot`, sample leaf).

Regenerate:

```bash
pnpm --filter @kargain/vincent build
pnpm --filter @kargain/vincent-compiler build
node compiler/scripts/gen-fixture.mjs
node compiler/scripts/gen-merkle-vectors.mjs
```

## Client decode stack

Compiled epochs are consumed at runtime by `@kargain/vincent` (published npm package):

1. **`@kargain/vincent/anchor`** — read `merkleRoot` and metadata from `VincentAnchorRegistry` (optional `viem` peer)
2. **`@kargain/vincent/arweave`** — reference `getLeaf(wmi)` via ANS-104 tags (injectable)
3. **`@kargain/vincent/decoder`** — Merkle-verify each leaf and decode VIN attributes

Runtime consumers verify manifest hashes and Merkle roots; they do not compile claims themselves. This package is for publishers and verifiers rebuilding epochs.
