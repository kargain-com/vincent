# Documentation

| Document | Status | Description |
|----------|--------|-------------|
| [PROTOCOL.md](PROTOCOL.md) | Published (v1.2) | Normative protocol specification |
| [SEED.md](SEED.md) | Published | Genesis seed corpus overview |
| [GOVERNANCE.md](GOVERNANCE.md) | Published | Governance model and decentralization roadmap |

See [CONTRIBUTING.md](../CONTRIBUTING.md) for how to propose changes to these documents.

## Library

Published npm package: [`@kargain/vincent`](../packages/vincent) — four entry points:

| Subpath | Purpose |
|---------|---------|
| `@kargain/vincent` | Core deterministic VIN APIs (no WMI data) |
| `@kargain/vincent/wmi` | Layered WMI lookup |
| `@kargain/vincent/protocol` | Claim/manifest parsing, JCS, EIP-191 signing |
| `@kargain/vincent/decoder` | Merkle-authenticated per-WMI leaf decoding via `createDecoder({ merkleRoot, getLeaf })` |

See the [package README](../packages/vincent/README.md) for API tables and usage.
