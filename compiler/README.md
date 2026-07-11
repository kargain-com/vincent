# @kargain/vincent-compiler

Private epoch compiler for the Vincent protocol (P-3). Accepts a signed claim set and produces:

- **Canonical JSONL** — normative, byte-reproducible artifact (JCS, sorted per PROTOCOL.md §7)
- **Derived SQLite cache** — lookup-optimized cache for decoder development (P-4)

This tool does **not** parse vPIC, fetch network data, or use production signing keys.

## Package layout

| Location | Role |
|----------|------|
| `src/compile.ts` | `compile(claims, policy)` pipeline |
| `src/verify-epoch.ts` | `verifyEpoch(manifest, claims)` rebuilt check (§6) |
| `fixtures/genesis-mini/` | Committed signed test claims + golden `jsonlSha256` |

**Why private:** The compiler is a build-time tool (like `pipeline/`), not a runtime library dependency. Consumers verify epochs via manifest hashes; they do not need this package on npm.

## API

```typescript
import { compile, verifyEpoch } from '@kargain/vincent-compiler';
import type { CompilePolicy, EpochBuild } from '@kargain/vincent-compiler';
```

### `compile(claims, policy?)`

1. Validates each claim (`parseClaim` + `verifyClaim` from `@kargain/vincent/protocol`)
2. Applies supersession: claim B with `supersedes: A` removes A when both are present
3. Resolves same-key conflicts by anchor order (§7.2); ties → compiler error
4. Emits sorted canonical JSONL and derived SQLite bytes

Returns `{ ok: true, value: EpochBuild }` or `{ ok: false, error }`.

**`EpochBuild`:** `{ jsonl, jsonlSha256, sqlite, sqliteSha256, claimCount, byType }`

### `verifyEpoch(manifest, claims)`

1. Verifies manifest signature
2. Compiles manifest-listed claims using `manifest.claims` as anchor order
3. Compares rebuilt `jsonlSha256` to `manifest.dataset.jsonlSha256`

This is the §6 **`rebuilt = true`** byte-reproducibility check. SQLite hash is not gated.

## Compile policy

```typescript
interface CompilePolicy {
  anchorOrder?: readonly string[];           // manifest.claims order for verifyEpoch
  anchorRank?: Readonly<Record<string, number>>; // explicit ranks; equal rank → tie error
}
```

Review weight (`minAccepts`, reviewers) is **out of scope** for P-3 — input is already the accepted set.

## JSONL contract

- One claim per line: RFC 8785 JCS via `canonicalize()` from `@kargain/vincent/protocol`
- Every line ends with `\n` (including the last)
- Sorted by `(type, key fields, claimHash)`:
  - Types lexicographic: `vds-binding` < `vds-pattern` < `vds-schema` < `wmi` < `year-hint`
  - `yearTo: null` sorts after integers; absent `match.vis` before present

**Determinism:** Two compiles of the same fixture must yield byte-identical JSONL (CI gate). SQLite is best-effort derived.

## SQLite schema (derived cache)

Normative source is JSONL. Tables support P-4 decoder lookups per PROTOCOL.md §4.4:

| Table | Primary key | Lookup purpose |
|-------|-------------|----------------|
| `wmi` | `wmi` | WMI → manufacturer, country, region |
| `vds_schema` | `claim_hash` | Schema name by hash |
| `vds_binding` | `claim_hash` | Bindings by `wmi` (index on `wmi`); `year_to` NULL = open range |
| `vds_pattern` | `claim_hash` | Patterns by `schema_hash` (index) |
| `year_hint` | `wmi` | Model-year cycle rule |
| `_meta` | `key` | `jsonl_sha256`, `claim_count`, `compiler_name`, `compiler_version` |

Example queries:

```sql
SELECT * FROM wmi WHERE wmi = '1FA';
SELECT * FROM vds_binding WHERE wmi = '1FA' AND year_from <= 2011 AND (year_to IS NULL OR year_to >= 2011);
SELECT * FROM vds_pattern WHERE schema_hash = 'sha256:...';
```

Built with **sql.js** (devDependency only). `sqliteSha256` is informative, not CI-gated.

## Fixture: `fixtures/genesis-mini/`

~11 signed claims using the P-1 Hardhat test key (`golden.json` private key):

| Content | Count |
|---------|-------|
| `wmi` | 2 (1FA Ford, VF3 Peugeot) |
| `vds-schema` | 1 |
| `vds-binding` | 2 (different year ranges) |
| `vds-pattern` | 5 (bodyType, fuelType, plant + supersession pair) |
| `year-hint` | 1 |
| Supersession | `Fusion-OLD` superseded by corrected `Fusion` pattern |

Golden hash in `fixtures/genesis-mini/golden.json`.

### Regenerate fixture

```bash
pnpm --filter @kargain/vincent-compiler build
node compiler/scripts/gen-fixture.mjs
```

Re-commit `claims.json` and `golden.json` if claim content changes.

## Development

```bash
pnpm install
pnpm --filter @kargain/vincent build   # protocol dependency
pnpm --filter @kargain/vincent-compiler test
```

From repo root: `pnpm lint && pnpm typecheck && pnpm build && pnpm test`

## Protocol reuse

All canonicalization, hashing, and signature verification delegate to `@kargain/vincent/protocol`. This package does not reimplement JCS, SHA-256, or EIP-191.
