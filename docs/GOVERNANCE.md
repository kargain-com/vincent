# Governance

This document describes how the Vincent repository and protocol are governed today, and how governance is expected to evolve.

## Current model

Vincent operates under a benevolent maintainer model. The founder of Kargain maintains this repository, merges pull requests, and publishes npm releases. Decisions about code, releases, and protocol changes rest with the maintainer after public review.

This is not decentralized governance. The maintainer has final say on what merges and ships. That arrangement is stated here explicitly rather than implied.

## Decision records

Protocol-affecting decisions are recorded in GitHub issues labeled `protocol`. Anyone may open such an issue to propose a change, raise a concern, or document a design choice.

A change to [PROTOCOL.md](PROTOCOL.md) requires a `protocol`-labeled issue first. The issue should be discussed and agreed in principle before a pull request modifies the normative spec. Merging a protocol change without a prior issue is out of process.

Code and documentation changes that do not affect the protocol follow the normal pull request process described in [CONTRIBUTING.md](../CONTRIBUTING.md).

## Planned decentralization

Governance is expected to decentralize in phases. Transitions depend on ecosystem maturity, not calendar dates.

| Phase | Model | Trigger |
|-------|-------|---------|
| 1 | Maintainer plus public review | Now — single maintainer, open issues and PRs |
| 2 | Multiple dataset publishers and reviewers via EAS attestations | Phase 2 begins when a second independent publisher exists and publishes signed manifests |
| 3 | Reviewer quorum outside the founding team | Phase 3 begins when a sufficient set of independent reviewers with attestation history can form a quorum without founding-team members |

Details of review policy, attestation schemas, and canon selection are defined in [PROTOCOL.md](PROTOCOL.md). This document only describes who decides, not the wire format.

## Forkability

The ultimate check on governance is forkability. Vincent code is MIT-licensed. Published data is CC0-1.0. Artifacts are content-addressed and self-contained.

If participants disagree with maintainer decisions, review policy, or canon selection, they can exit with full code, data, and reputation. No component is irreplaceable. See [section 1 (Invariants)](PROTOCOL.md#1-invariants) and [section 9 (Anchoring and canon selection)](PROTOCOL.md#9-anchoring-and-canon-selection) in the protocol specification.

Forking is a feature, not a failure mode. Competing manifests, reviewer sets, and client policies are expected under the protocol.
