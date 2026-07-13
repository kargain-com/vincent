# Vincent

**Status:** library `@kargain/vincent` 0.10.0; protocol spec v1.2 published (Merkle-authenticated per-WMI leaves)

Vincent is an offline-first VIN decoder and an open protocol for community-curated VIN data. Claims are unsigned content-addressed fact cores; attestations and epoch manifests are signed with Ethereum keys. Data is stored content-addressed on Arweave and anchored on EVM chains. The normative protocol specification is in [docs/PROTOCOL.md](docs/PROTOCOL.md).

Install: `npm install @kargain/vincent` (add `viem` only if you use `@kargain/vincent/anchor` to read on-chain epochs).

## Contributing

See [CONTRIBUTING.md](CONTRIBUTING.md) for development setup, code rules, and how to contribute code or data.

## Protocol invariants

1. **Canonical data lives off-chain.** No blockchain holds the authoritative dataset.
2. **Every fact is a content-addressed claim with provable provenance and an immutable history.** Attestation is separate from the fact core.
3. **No irreplaceable components.** The protocol is fully permissionless and forkable.
4. **MIT code, CC0 data.** Source code is MIT-licensed; published data is CC0-1.0 (see [DATA-LICENSE.md](DATA-LICENSE.md)).
5. **Decoding is a pure client-side function.** No API sits in the critical path.

## Packages

| Package | Description |
|---------|-------------|
| [`@kargain/vincent`](packages/vincent) | Published library — core (`.`), WMI (`./wmi`), protocol (`./protocol`), decoder (`./decoder`), Arweave leaf fetch (`./arweave`), on-chain epoch reader (`./anchor`, optional `viem` peer) |
| [`@kargain/vincent-compiler`](compiler) | Private epoch compiler (workspace only) |
| [`@kargain/vincent-pipeline`](pipeline) | Private WMI data generator (workspace only) |
| [`@kargain/vincent-publish`](publish) | Private genesis publish tooling (workspace only) |
| [`@kargain/vincent-contracts`](contracts) | Private on-chain registry (Hardhat 3, workspace only) |

See the [package README](packages/vincent/README.md) for entry points, API tables, and usage examples.

## Roadmap

| Phase | Focus | Status |
|-------|-------|--------|
| R | Repository skeleton and protocol specification | Done |
| V | Deterministic VIN layer and client-side decoder | Shipped (core, WMI, decoder, arweave, anchor) |
| P | Attestations, manifests, and epoch compiler | Shipped (protocol module, private compiler) |
| A | Arweave storage and EVM anchoring | In progress (client libs shipped; registry deploy + genesis publish tooling in repo) |

## License

Code: [MIT](LICENSE). Data: [CC0-1.0](DATA-LICENSE.md).
