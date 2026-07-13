# @kargain/vincent-publish

## Unreleased

### Minor Changes

- Checkpoint schema v2 fields: `uploadedLeafKeys`, `indexVerifiedLeafKeys`, `failedLeafKeys`, `leafUris`, optional `leafUriSidecarUri`.
- Gateway-first index-check with bulk `backfill:leaf-uris` CLI and stderr backfill hints.
- Leaf URI sidecar: `export:leaf-uris`, `publish:leaf-uris`, opt-in `--publish-leaf-uris-sidecar`, verify discovery via `resolveVerifierLeafUris`.
- Dual-network CLI: `--network base-sepolia|base`, `--devnet` / `--mainnet` aliases, `resolvePublishNetwork`, unified `createIrysUploader` / `createRegistryPublisher`.
- Mainnet re-upload guards (`--allow-reupload`, `--max-reupload-leaves`) and mainnet timing defaults.

- Updated dependencies
  - @kargain/vincent@0.8.0

## 0.0.2

### Patch Changes

- Updated dependencies [771f0e7]
- Updated dependencies [2273967]
  - @kargain/vincent@0.7.0
  - @kargain/vincent-compiler@0.0.2
