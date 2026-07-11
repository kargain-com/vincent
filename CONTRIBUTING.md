# Contributing

Thank you for your interest in Vincent. This repository accepts two kinds of contribution: code (pull requests here) and data (signed claims per the protocol). Only code contributions have tooling today.

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
| `packages/vincent` | `@kargain/vincent` — published library (core module today) |
| `pipeline/` | Private WMI generator (`@kargain/vincent-pipeline`) |
| `docs/` | Normative protocol specification and governance documents |
| `contracts/` (planned, phase A) | On-chain manifest registry |

Package names use the `@kargain` npm scope. See [README.md](README.md) for the phase roadmap.

## Code rules

- TypeScript strict mode; no `any`.
- No `console.log` in package source (`packages/**/src`).
- Zero runtime dependencies in packages unless an open issue explicitly approves an exception.
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

Vincent data lives outside this repository. A data contribution is a signed claim document published to content-addressed storage and optionally reviewed via EAS attestations. Claims are not committed as files in this repo.

Contribution tooling (signing, upload, review workflows) ships in phase C. Until then, read the protocol specification to understand claim format, provenance, evidence rules, signatures, and review:

- [Claims (section 4)](docs/PROTOCOL.md#4-claims)
- [Signatures (section 5)](docs/PROTOCOL.md#5-signatures)
- [Review and attestations (section 6)](docs/PROTOCOL.md#6-review-and-attestations)

Every data contribution must include an explicit CC0-1.0 dedication. See [DATA-LICENSE.md](DATA-LICENSE.md).

## Protocol changes

Changes to [docs/PROTOCOL.md](docs/PROTOCOL.md) affect all implementations. Propose them through a GitHub issue labeled `protocol` before opening a spec PR. Process and governance phases are described in [docs/GOVERNANCE.md](docs/GOVERNANCE.md).

Use the protocol change issue template when available. Breaking wire-format changes require a new `schemaVersion` per the spec.

## Code of conduct

All participants are expected to follow [CODE_OF_CONDUCT.md](CODE_OF_CONDUCT.md).
