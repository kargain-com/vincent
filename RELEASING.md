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

4. **Publish manually.**

   ```bash
   pnpm --filter @kargain/vincent publish --access public
   ```

   Do not publish from automated CI until provenance and token handling are in place.

5. **Verify on npm.** Confirm the new version appears at [npmjs.com/package/@kargain/vincent](https://www.npmjs.com/package/@kargain/vincent) and that the tarball contains `dist/`, `README.md`, and `LICENSE`.

## Notes

- **Future decoder module:** When the client-side decoder ships, it will declare `@sqlite.org/sqlite-wasm` as an optional peer dependency.
- **npm provenance:** Deferred until CI publishing is implemented.
- **Dry-run before first publish:** Use `pnpm --filter @kargain/vincent pack` to inspect tarball contents without publishing.
