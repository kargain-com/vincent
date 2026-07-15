# @kargain/vincent-compiler

## 0.1.0

### Minor Changes

- First public npm release. Distribution change only — no API or behavior changes. Published so independent verifiers can byte-rebuild epochs (`verifyEpoch`, the §6 `rebuilt = true` check) and publishers can compile epochs without cloning the repository. Runtime VIN decoding still only requires `@kargain/vincent`.

## 0.0.2

### Patch Changes

- Updated dependencies [771f0e7]
- Updated dependencies [2273967]
  - @kargain/vincent@0.8.0

## 0.0.1

### Patch Changes

- Merkle-authenticated leaves (paired with `@kargain/vincent@0.6.0`): `buildLeaves` + `buildMerkle` replace two-level shards and flat index; `EpochBuild` commits `merkleRoot` and per-WMI `{ leaf, leafHash, proof }`.
- Updated dependencies
  - @kargain/vincent@0.6.0
