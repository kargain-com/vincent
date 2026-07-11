# @kargain/vincent-compiler

Private epoch compiler for the Vincent protocol (P-3). Accepts an accepted claim set and produces:

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

**Why private:** The compiler is a build-time tool (like `pipeline/`), not a runtime library dependency. Consumers verify epochs via manifest hashes; they do not need this package on npm.

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

1. Verifies manifest signature
2. Compiles manifest-listed claims using `manifest.claims` as anchor order
3. Compares rebuilt `jsonlSha256` and `merkleRoot` to `manifest.dataset`

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
