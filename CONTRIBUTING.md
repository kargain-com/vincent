# Contributing

Thank you for your interest in Vincent. This repository accepts two kinds of contribution: code (pull requests here) and data (unsigned claim fact cores per the protocol, optionally endorsed via attestations). Only code contributions have tooling today.

## Development setup

Requirements:

- Node.js 24 LTS
- pnpm 11 (via Corepack)

```bash
corepack enable
pnpm install
pnpm lint && pnpm typecheck && pnpm build && pnpm test
```

All four commands must pass before you open a pull request. CI runs the same checks.

## Repository layout

| Path | Purpose |
|------|---------|
| `packages/vincent` | `@kargain/vincent` — published library (`.`, `./wmi`, `./protocol`, `./decoder`, `./arweave`, `./anchor`) |
| `compiler/` | `@kargain/vincent-compiler` — private epoch compiler (workspace only) |
| `pipeline/` | `@kargain/vincent-pipeline` — private WMI / seed generator (workspace only) |
| `publish/` | `@kargain/vincent-publish` — private genesis publish tooling (workspace only) |
| `docs/` | Normative protocol specification and governance documents |
| `contracts/` | `@kargain/vincent-contracts` — private on-chain epoch registry (Hardhat 3) |

Package names use the `@kargain` npm scope. See [README.md](README.md) for the phase roadmap.

## Code rules

- TypeScript strict mode; no `any`.
- No `console.log` in package source (`packages/**/src`).
- Zero runtime dependencies in the main entry (`.`) and `./wmi` subpaths; any exception must stay isolated to its own subpath (e.g. `./protocol`, optional `./anchor` with `viem` as an optional peer). Additional runtime dependencies are added deliberately and must be justified in the changeset; while the project has a single maintainer, no GitHub issue is required.
- Behavior changes require tests.
- Every package change requires a changeset: run `pnpm changeset` and commit the generated file.

ESLint and TypeScript enforce most of these. Reviewers will reject PRs that skip tests or changesets for package work.

## Pull requests

- Keep PRs small and focused on one change.
- CI must be green before review.
- The maintainer reviews and merges all PRs.
- By submitting a code contribution, you agree it is licensed under the project MIT license (inbound = outbound). See [LICENSE](LICENSE).

Report security issues privately — see [SECURITY.md](SECURITY.md). Do not open public issues for vulnerabilities.

## Data contributions

Vincent data lives outside this repository. A data contribution is an unsigned claim fact core published to content-addressed storage, optionally endorsed via EAS attestations, and compiled into signed epoch manifests. Claims are not committed as files in this repo.

Contribution tooling (signing, upload, review workflows) ships in phase C. Until then, read the protocol specification to understand claim format, provenance, evidence rules, signatures, and review:

- [Claims (section 4)](docs/PROTOCOL.md#4-claims)
- [Signatures (section 5)](docs/PROTOCOL.md#5-signatures)
- [Review and attestations (section 6)](docs/PROTOCOL.md#6-review-and-attestations)

Every data contribution must include an explicit CC0-1.0 dedication. See [DATA-LICENSE.md](DATA-LICENSE.md).

## Protocol changes

Changes to [docs/PROTOCOL.md](docs/PROTOCOL.md) affect all implementations. Protocol and dependency decisions land through pull requests with a changeset; process and governance phases are described in [docs/GOVERNANCE.md](docs/GOVERNANCE.md). A prior GitHub issue is not required in phase 1.

Breaking wire-format changes require a new `schemaVersion` per the spec.

## Code of conduct

All participants are expected to follow [CODE_OF_CONDUCT.md](CODE_OF_CONDUCT.md).
