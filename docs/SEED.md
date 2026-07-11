# Genesis seed

The **genesis seed** is the first vPIC-derived claim corpus for Vincent epoch 0: unsigned content-addressed `wmi`, `vds-schema`, `vds-binding`, and `vds-pattern` fact cores covering the genesis profile attributes defined in [PROTOCOL.md](PROTOCOL.md) §4.2. Leaf construction and Merkle authentication happen at compile time via `@kargain/vincent-compiler`.

## What it contains

| Claim type | Source | Count (approx.) |
|------------|--------|-----------------|
| `wmi` | `vpic.wmi` + manufacturer/country/vehicletype lookups | 12,902 |
| `vds-schema` | `vpic.vinschema` | 24,947 |
| `vds-binding` | `vpic.wmi_vinschema` | 41,610 |
| `vds-pattern` | `vpic.pattern` (profile element IDs only) | 538,713 |

Pattern `keys` values are converted to protocol `match` objects; rows whose grammar is unsupported (I/O/Q literals, `#`, etc.) are skipped (~0.03%, well under the 2% gate).

## Provenance and license

Every claim uses:

- `provenance: "regulatory/us-vpic"`
- `license: "CC0-1.0"`

Value vocabulary is taken verbatim from vPIC lookup tables and literals (trimmed only). Canonicalization of codes is a later review concern.

## Build artifact

The full seed is emitted as canonical JSONL to `pipeline/.build/genesis-seed.jsonl`. It is **not committed** to git — only the small VIN fixture at `pipeline/fixtures/seed-vins/cases.json` is committed for validation.

## Determinism

Two runs with the same vPIC dump bytes and the same signing key produce byte-identical JSONL. Hashes change only when the key changes; structure and ordering are stable.

## Regeneration

See [pipeline/README.md](../pipeline/README.md) for commands, key handling, and validation steps.

## Phase A (future)

This iteration uses the P-1 test key for dev/validation. Phase A will:

1. Re-run `generate:seed` with the real genesis signing key
2. Upload the canonical JSONL to Arweave
3. Anchor `jsonlSha256` and `merkleRoot` on-chain

No network, Arweave, or chain operations are performed in the current pipeline tooling.
