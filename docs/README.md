# Documentation

| Document | Status | Description |
|----------|--------|-------------|
| [PROTOCOL.md](PROTOCOL.md) | Published (v1.2) | Normative protocol specification |
| [SEED.md](SEED.md) | Published | Genesis seed corpus overview |
| [GOVERNANCE.md](GOVERNANCE.md) | Published | Governance model and decentralization roadmap |
| [contracts/](contracts/) | Published | On-chain VincentAnchorRegistry address table |

Local maintainer memory (`HANDOFF.md`, `SESSION.md`, and
`publish/docs/MAINNET_READINESS.md`) is **gitignored** — create/update on the
machine only; never commit.

See [CONTRIBUTING.md](../CONTRIBUTING.md) for how to propose changes to these documents.

## Library

Published npm package: [`@kargain/vincent`](../packages/vincent) (0.8.0) — six entry points:

| Subpath | Purpose | Optional peer |
|---------|---------|---------------|
| `@kargain/vincent` | Core deterministic VIN APIs (no WMI data) | — |
| `@kargain/vincent/wmi` | Layered WMI lookup | — |
| `@kargain/vincent/protocol` | Claim/manifest parsing, JCS, EIP-191 signing | `@noble/*` (bundled) |
| `@kargain/vincent/decoder` | Merkle-authenticated per-WMI leaf decoding via `createDecoder({ merkleRoot, getLeaf })` | — |
| `@kargain/vincent/arweave` | Reference ANS-104 tag-query `getLeaf` provider via `createArweaveGetLeaf(...)` | — |
| `@kargain/vincent/anchor` | Read `VincentAnchorRegistry` epochs via `createAnchorReader(...)` | `viem` |

End-to-end live decode: `./anchor` (on-chain root) → `./arweave` or custom `getLeaf` → `./decoder`. Core subpaths (`.`, `./wmi`, `./protocol`, `./decoder`, `./arweave`) stay viem-free; only `./anchor` imports `viem`.

See the [package README](../packages/vincent/README.md) for quick start, full decode example, and API tables.

## Private workspace packages

| Package | README |
|---------|--------|
| `@kargain/vincent-compiler` | [compiler/README.md](../compiler/README.md) |
| `@kargain/vincent-pipeline` | [pipeline/README.md](../pipeline/README.md) |
| `@kargain/vincent-publish` | [publish/README.md](../publish/README.md) |
| `@kargain/vincent-contracts` | [contracts/README.md](../contracts/README.md) |

Release process: [RELEASING.md](../RELEASING.md).
