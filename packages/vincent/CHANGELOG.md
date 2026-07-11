# @kargain/vincent

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
