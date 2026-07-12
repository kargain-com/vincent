# Releasing

This document is the founder runbook for publishing `@kargain/vincent` to npm. Publishing is a manual step — it is not automated in CI.

## Prerequisites

- Node.js 24+ and pnpm 11 (via Corepack)
- npm account with publish access to the `@kargain` scope
- All CI checks green on the release commit (`pnpm lint && pnpm typecheck && pnpm build && pnpm test`)

## Release workflow

1. **Ensure changesets are current.** If the release includes user-facing changes since the last version, run `pnpm changeset` and commit any new changeset files.

2. **Version the package.**

   ```bash
   pnpm changeset version
   ```

   Review the bumped version in `packages/vincent/package.json` and the generated `packages/vincent/CHANGELOG.md`.

3. **Commit the version bump.**

   ```bash
   git add -A
   git commit -m "chore: release @kargain/vincent vX.Y.Z"
   ```

4. **Dry-run before publishing.** Inspect tarball contents and entry-point sizes:

   ```bash
   pnpm --filter @kargain/vincent pack
   ```

   Confirm the tarball includes:
   - `dist/index.js` (main entry, no WMI data)
   - `dist/wmi-export.js`, `dist/wmi-core.generated.js`, `dist/wmi-extended.generated.js`
   - `dist/decoder-export.js`, `dist/arweave-export.js`, `dist/anchor-export.js`
   - `dist/protocol/index.js`
   - `README.md`, `LICENSE`

5. **Publish manually.**

   ```bash
   pnpm --filter @kargain/vincent publish --access public
   ```

   If the npm org requires 2FA, pass `--otp=123456`. Do not publish from automated CI until provenance and token handling are in place.

6. **Verify on npm.** Confirm the new version appears at [npmjs.com/package/@kargain/vincent](https://www.npmjs.com/package/@kargain/vincent) and that subpath exports resolve (`/decoder`, `/arweave`, `/anchor`, etc.).

## npm publish troubleshooting

A **404 on PUT** for an existing scoped package usually means **auth or permissions**, not a missing package:

1. Run `npm whoami` — if unauthorized, run `npm login`.
2. Confirm your account is a maintainer on `@kargain/vincent` at [npmjs.com/package/@kargain/vincent](https://www.npmjs.com/package/@kargain/vincent).
3. Use a publish-capable token (Automation or granular token with publish scope). Read-only tokens return 404.
4. Pass `--otp=…` when 2FA is enabled on the org or account.

## Notes

- **Entry points:** `@kargain/vincent` ships six subpaths (`.`, `./wmi`, `./protocol`, `./decoder`, `./arweave`, `./anchor`). Core subpaths remain viem-free; `./anchor` lists `viem` as an optional peer.
- **Decoder module:** `@kargain/vincent/decoder` is dependency-free. Consumers pass the anchored `merkleRoot` (from `./anchor` or a verified manifest) and an async `getLeaf(wmi)` provider (reference: `./arweave`).
- **npm provenance:** Deferred until CI publishing is implemented.
