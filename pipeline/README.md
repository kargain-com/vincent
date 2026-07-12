# Vincent pipeline

Private tooling for generating vPIC-derived artifacts used by `@kargain/vincent`.

## Scripts

| Command | Description |
|---------|-------------|
| `pnpm generate:wmi` | Generate bundled `wmi-core` / `wmi-extended` tables from the cached vPIC dump |
| `pnpm generate:seed` | Build the genesis seed (unsigned fact-core claims JSONL) from the cached vPIC dump |
| `pnpm validate:seed` | Fast validation: reuse `pipeline/.build/genesis-seed.jsonl`, compile once, decode 20 fixture VINs, self-consistency sample, timing/Merkle leaf metrics (~few min). Uses `node --max-old-space-size=8192`. Not run by `pnpm test`. |
| `pnpm validate:seed --regen` | Regenerate seed once, then run full validation |
| `pnpm validate:seed --determinism` | Opt-in two-run byte-identity seed generation check (~10–15 min) |

Root aliases: `pnpm generate:seed`, `pnpm validate:seed`.

## Genesis seed

The genesis seed is the vPIC profile-attribute corpus expressed as unsigned content-addressed fact-core claims of four types:

- **`wmi`** — manufacturer / country / vehicleType / region (one per WMI)
- **`vds-schema`** — one per vPIC `vinschema` row
- **`vds-binding`** — WMI + model-year range → schema
- **`vds-pattern`** — decode rules for genesis profile attributes (model, bodyType, fuelType, driveType, transmission, series, engine, engineCylinders, displacementL, plant)

Provenance: `regulatory/us-vpic`. License: `CC0-1.0`.

### Output

- Path: `pipeline/.build/genesis-seed.jsonl` (gitignored build artifact)
- Deterministic given `(dump bytes, signing key)` — stable ordering, no timestamps
- Phase A publish path: `@kargain/vincent-publish` (genesis upload + on-chain anchor); client decode via `@kargain/vincent/anchor` → `@kargain/vincent/arweave` → `@kargain/vincent/decoder`

### Prerequisites

1. Cached vPIC plain SQL at `pipeline/.cache/extracted/vPICList_lite_2026_06.sql`
   - Populated automatically by `generate:wmi` (downloads and verifies sha256-pinned zip)
2. Built packages: `pnpm build`

### Signing key

Never commit a production key. Configure via environment:

| Variable | Description |
|----------|-------------|
| `VINCENT_SEED_PRIVATE_KEY` | `0x`-prefixed hex private key |
| `VINCENT_SEED_PRIVATE_KEY_FILE` | Path to a file containing the hex key |

Default for dev/validation: P-1 Hardhat test key (same as compiler fixtures).

### Regenerate

```bash
pnpm build
pnpm generate:seed          # optional if seed already in .build/
pnpm validate:seed          # fast: reuse .build seed, compile + fixtures + metrics
pnpm validate:seed --regen  # regenerate seed once, then validate
pnpm validate:seed --determinism  # opt-in two-run byte-identity check
```

Automated tests use the committed `compiler/fixtures/genesis-mini` claims only (fast, cache-free). Full vPIC seed validation runs exclusively via `validate:seed`.

### Fixtures

Committed VIN fixtures for end-to-end validation: `pipeline/fixtures/seed-vins/cases.json` (~20 hand-verified cases).

Regenerate fixtures after seed changes (requires built seed):

```bash
node pipeline/dist/gen-seed-fixtures.js
```

## vPIC source

- File: `vPICList_lite_2026_06.plain.zip`
- Expected sha256: `ab16275b0994e79b2d9f0fba512797631a107e2c5e18182b043d97a17ef02ea9`
- Parsed as PostgreSQL plain-text COPY blocks — no live PostgreSQL required

## Note on bundled WMI tables

The committed `./wmi` lookup tables (`wmi-core.generated.ts`, `wmi-extended.generated.ts`) are generated separately. Converging them to the protocol `wmi` claims in the seed is tracked future work; the seed generator does not modify `./wmi`.
