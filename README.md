# Vincent

**Status:** pre-alpha, protocol spec v0.1 published

Vincent is an offline-first VIN decoder and an open protocol for community-curated VIN data. Claims are signed with Ethereum keys, stored content-addressed on Arweave, and anchored on EVM chains. The normative protocol specification is in [docs/PROTOCOL.md](docs/PROTOCOL.md).

## Contributing

See [CONTRIBUTING.md](CONTRIBUTING.md) for development setup, code rules, and how to contribute code or data.

## Protocol invariants

1. **Canonical data lives off-chain.** No blockchain holds the authoritative dataset.
2. **Every fact is a signed claim.** Each assertion has provable provenance and an immutable history.
3. **No irreplaceable components.** The protocol is fully permissionless and forkable.
4. **MIT code, CC0 data.** Source code is MIT-licensed; published data is CC0-1.0 (see [DATA-LICENSE.md](DATA-LICENSE.md)).
5. **Decoding is a pure client-side function.** No API sits in the critical path.

## Packages

| Package | Description |
|---------|-------------|
| [`@kargain/vincent`](packages/vincent) | Offline-first VIN library — deterministic core APIs today; protocol and decoder modules ship in later releases |

## Roadmap

| Phase | Focus |
|-------|-------|
| R | Repository skeleton and protocol specification |
| V | Deterministic VIN layer and client-side decoder |
| P | Signed claims, manifests, and epoch compiler |
| A | Arweave storage and EVM anchoring |

## License

Code: [MIT](LICENSE). Data: [CC0-1.0](DATA-LICENSE.md).
