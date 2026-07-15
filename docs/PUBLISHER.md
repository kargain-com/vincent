# Individual Community Publisher Runbook

**Status:** non-normative. This runbook describes the reference tooling
(`@kargain/vincent-publish`, workspace-only) for an **active verifier** who
publishes community epochs individually on their **own**
`VincentAnchorRegistry` chain, self-funded. The normative rules live in
[PROTOCOL.md](PROTOCOL.md) (§4.8, §6, §7, §8, §8.1); the community canon
profile lives in [COMMUNITY-CANON.md](COMMUNITY-CANON.md).

## 1. Prerequisites

- **Node >= 24** and `pnpm` (this is a workspace tool; clone the repo and run
  `pnpm install && pnpm build`).
- **A dedicated publisher wallet with Base Sepolia ETH.** One wallet funds both
  the on-chain anchor gas and the permanent storage: uploads are paid to Irys
  **devnet** (`devnet.irys.xyz`) via **`base-eth` on Base Sepolia** (PROTOCOL
  §8). Do not use Ethereum Sepolia for Irys funding. The CLI quotes the upload
  cost up front (remaining bytes only) and funds your Irys account from the
  same wallet when short.
- **Assembler artifacts from the Kargain side** (format frozen):
  - `accepted-community-claims.jsonl` — accepted community claim fact cores,
    one JCS line per claim.
  - `attestation-archive.json` — signed review documents per claim hash
    (endorse/reject + transport metadata, optional proposal snapshots).
  - `assembly-report.json` — the assembler's audit report. It is **not** a CLI
    input; keep it for your records.
- **The base epoch coordinates**: the base publisher address and the on-chain
  epoch index you snapshot on top of (for example the foundational genesis,
  index `0`). The tooling fetches the base epoch from the registry and the
  gateway — never from a local build artifact — and verifies the manifest hash,
  the manifest signature, and `dataset.jsonlSha256` fail-closed before use.

### Key hygiene

- The publisher key is **dedicated**: it must not be shared with any other
  system and must not be reused for anything else (not a hot marketplace key,
  not a deploy key, not the foundational genesis key).
- The env var is deliberately distinct: `VINCENT_PUBLISHER_PRIVATE_KEY`
  (community rails), never `VINCENT_GENESIS_PRIVATE_KEY`.
- The **foundational-genesis guards are untouched**: `publish:genesis` /
  `--genesis` (`requireGenesis`, epochCount-must-be-0, retired signing key per
  §8.1) is a separate path and is **not** used here. Your first community epoch
  is a genesis **of your own chain** (`parent: null` on your own address) with
  a live key — that is the §8.1 overlay/growth role, not the frozen
  foundational role.

## 2. Configuration

Create `publish/.env`:

```ini
VINCENT_PUBLISHER_PRIVATE_KEY=0x...   # dedicated community publisher key
BASE_SEPOLIA_RPC_URL=https://...
# Optional overrides:
# IRYS_GATEWAY_URL=https://testnet-gateway.irys.xyz
# IRYS_GRAPHQL_URL=https://uploader.irys.xyz/graphql
```

## 3. Publish

```sh
pnpm --filter @kargain/vincent-publish publish:community -- \
  --network base-sepolia \
  --claims  /path/to/accepted-community-claims.jsonl \
  --archive /path/to/attestation-archive.json \
  --base    0xBasePublisher...:0 \
  --jitter-days 7
```

Pipeline (checkpointed and resumable at every stage):

1. Fetch + verify the base epoch (registry → manifest by URI → dataset JSONL
   from `dataset.uris`, `jsonlSha256` verified, every line `parseClaim`-validated).
2. Parse + validate every community claim; hard gate: each one must have at
   least one valid `endorse` in the archive.
3. Merge into a **full snapshot** (base + community, deduplicated by claim
   hash) and compile with `@kargain/vincent-compiler`.
4. Jitter gate (see below).
5. Upload the attestation archive byte-for-byte as an ANS-104 item tagged
   `App=vincent`, `Epoch=<n>`, `Kind=review-archive` — a **non-normative
   sidecar** (see COMMUNITY-CANON.md).
6. Upload leaves + gzipped JSONL + signed manifest, index-check, then anchor
   `publishEpoch(merkleRoot, jsonlSha256, manifestHash, parentRoot, manifestUri)`
   on your own address. Lineage is your own chain: first epoch anchors with
   zero `parentRoot` and `parent: null` in the manifest; epoch N+1 uses your
   prior epoch's `merkleRoot`.
7. The manifest declares `reviewPolicy: { minAccepts: 1, reviewers: [...] }`
   with the archive's endorse attesters — see COMMUNITY-CANON.md for why the
   effective acceptance rule is stricter and client-side.

### Randomized delay (`--jitter-days <n>`, PROTOCOL §4.8)

Claims derived from real transactions MUST be batched and published with
randomized delay. The jitter covers the **whole publish, uploads included** —
an Arweave upload is already a public appearance. Mechanics:

- On the first run, the CLI picks a crypto-random target inside
  `[now, now + n days]`, persists it in the checkpoint
  (`publishNotBefore`), performs **no uploads**, and prints the publish
  window. Re-running never re-rolls the window.
- Until the target, every upload/anchor stage refuses to run. There is no
  sleeping process — the key stays offline between runs. When the window
  opens, re-run the exact same command.
- `--force` skips the gate. **Testnet-only.**

### Resume flags

Same semantics as the genesis CLI: `--upload-only` (no index-check/anchor),
`--retry-failed` (re-upload only checkpointed failures), `--anchor-only`
(skip uploads; index-check from checkpointed leaf URIs, then anchor),
`--checkpoint-file <path>` (default `publish/.vincent-community-checkpoint.json`
— separate from the genesis checkpoint), plus the index-check tuning flags
(`--index-check-concurrency/-delay/-timeout`, `--allow-reupload`,
`--max-reupload-leaves`).

## 4. Cost note

The preflight quotes the Irys price for the **remaining** bytes only (leaves
not yet uploaded + JSONL + manifest + the archive sidecar if not yet uploaded),
applies a 1.1 buffer, and auto-funds your Irys account from the wallet,
reserving ~0.001 ETH for the funding transaction gas. A full-seed-sized
snapshot is thousands of leaf items; budget accordingly and prefer resuming an
interrupted run over restarting (the checkpoint skips everything already
uploaded).

## 5. After publishing

The CLI prints the epoch, parent, `jsonlUri`, `manifestUri`, `manifestHash`,
`reviewArchiveUri`, and the anchor `txHash`, then re-reads the chain and
verifies the anchored roots match (PASS/FAIL). To get your epoch **confirmed**
into the community canon, independent verifiers rebuild it with the published
compiler and attest `rebuilt = true` — the confirmer flow is documented in
[COMMUNITY-CANON.md](COMMUNITY-CANON.md).
