# @kargain/vincent

## 0.10.0

### Minor Changes

- **Gateway-first Arweave helpers:** `createArweaveGetLeafWithUris` (checkpoint `leafUris` hint layer), `fetchLeafFromGateway`, `verifyLeafFromGateway`, `resolveLeafTxId`, `leafTxIdToUri`, and bulk `backfillLeafUrisFromGraphql` (owner+epoch GraphQL pagination).
- **Leaf URI sidecar (optional hint index):** `buildLeafUriSidecar`, `parseLeafUriSidecar`, `validateLeafUriSidecar`, `serializeLeafUriSidecar`, `fetchLeafUriSidecar`, `discoverLeafUriSidecar`, `resolveVerifierLeafUris`, and `LEAF_URI_SIDECAR_KIND` (`Kind=leaf-uris` bulk index bound to epoch fingerprint; normative per-leaf discovery unchanged).

## 0.7.0

### Minor Changes

- 771f0e7: Add `@kargain/vincent/anchor` with `createAnchorReader` for reading VincentAnchorRegistry epochs (viem optional peer). Includes protocol-ready bytes32→sha256 conversion and README end-to-end decode example.
- 2273967: Add the public zero-dependency `@kargain/vincent/arweave` subpath with `createArweaveGetLeaf` for ANS-104 tag-query leaf discovery. This pairs with `@kargain/vincent/decoder` to give consumers the full client decode stack; `getLeaf` remains injectable, so Arweave is only the reference backend and mirrors, caches, or alternate sources can be supplied instead.

## 0.6.0

### Minor Changes

- Protocol v1.2 + Merkle-authenticated dataset (0.6.0):

  - **Claims:** content-addressed fact cores (`claimHash`); no inline `signature`/`contributor`. Individual endorsement via `Attestation` (`attest`/`verifyAttestation`).
  - **WMI:** required-nullable `country`/`vehicleType`; 3- or 6-character WMI keys.
  - **Dataset:** replace flat WMI index + two-level shards with self-contained per-WMI leaves and an RFC 6962–style Merkle tree. Manifest commits `jsonlSha256` + `merkleRoot` (rejects legacy `indexSha256` / `sqliteSha256`).
  - **Decoder:** `createDecoder({ merkleRoot, getLeaf(wmi) })` with async `origin(vin)` (bundled `./wmi` + `vinRegion`) and async `decode(vin)`. Fetches one leaf + proof per VIN; verifies against the anchored root. Zero peer dependencies; no SQLite/WASM.
  - **Breaking:** removed flat `DecoderIndex` / `GetShard` API; `origin` is async; `DecodedWmi.region` uses `VinRegion` slugs (e.g. `north-america`).

## 0.5.0

### Minor Changes

- Add `@kargain/vincent/decoder` subpath: offline VIN attribute decoding from compiler-produced SQLite epoch datasets via optional `@sqlite.org/sqlite-wasm` peer dependency.

## 0.4.0

### Minor Changes

- PROTOCOL v1.1 schema-based VDS claim types (`vds-schema`, `vds-binding`, revised `vds-pattern`), match grammar validation via `parseMatchSegment`, and fail-closed parsing per updated PROTOCOL.md.

## 0.3.0

### Minor Changes

- Add `@kargain/vincent/protocol` subpath with RFC 8785 JCS canonicalization, SHA-256 hashing, EIP-191 signing/verification, and fail-closed parsing per PROTOCOL.md v0.1.

## 0.2.0

### Minor Changes

- Split WMI lookup data into layered core (3-char) and extended (6-char) modules. `lookupWmi` now imports from `@kargain/vincent/wmi` instead of the main entry; `validateVin` and other core APIs are unchanged on `@kargain/vincent`.
- `lookupWmi` is async (`Promise<WmiInfo | null>`) so the first call always returns the final answer after any required data loads — same input always yields the same output.

## 0.1.0

### Minor Changes

- Initial release: deterministic VIN APIs (normalization, validation, check digit, model year, region) and WMI lookup from committed NHTSA vPIC data with pipeline generator.
