# @kargain/vincent-publish

Offline epoch manifest build, sign, and publish tooling (Vincent Phase A).

This package produces a signed epoch **manifest** that commits `dataset.merkleRoot` and
`dataset.jsonlSha256`. The manifest is what `VincentAnchorRegistry.publishEpoch` anchors
on-chain (`manifestHash` + `manifestUri`).

## Publisher roles

The append-only per-publisher epoch chain serves two roles (see [PROTOCOL §8.1](../docs/PROTOCOL.md)):

| | `publish:genesis` / `--genesis` | `publish:epoch` (auto) |
|---|---|---|
| **When** | Fresh wallet (`epochCount == 0`) only | Fresh wallet → genesis; used wallet → incremental epoch N+1 |
| **Key lifecycle** | Retire after mainnet foundational genesis | Keep live for testnet / overlay growth |
| **Preflight** | Aborts if `epochCount > 0` (`requireGenesis`) | Fetches prior `merkleRoot` when `epochCount > 0` |

Foundational genesis is one epoch per address, keyless and frozen. Overlay publishers reuse the same wallet for dataset updates via incremental epochs linked by `parentRoot`.

## Manifest shape (genesis / large epochs)

- `parent`: always present — `null` for genesis (epoch 1); for later epochs, the prior
  epoch's `merkleRoot` (same value as on-chain `parentRoot`).
- `claims[]`: **omitted** for large epochs; the accepted claim set is committed by
  `dataset.jsonlSha256` over the canonical JSONL artifact (listed in `dataset.uris`).
- `dataset`: `{ jsonlSha256, merkleRoot, uris[] }` — JSONL artifact for audit; leaves
  are discovered via ANS-104 tags (`owner=publisher`, `Epoch`, `LeafKey`), not URIs.

## API (A-2a)

```typescript
import {
  buildManifest,
  signManifest,
  manifestHash,
  verifySignedManifest,
} from '@kargain/vincent-publish';
```

Signing, hashing, and canonicalization reuse `@kargain/vincent/protocol` (EIP-191 + JCS).

## Programmatic automation (Kargain)

Checkpoint resume, index verification, backfill, and Base Sepolia chain adapters are
exported from the package root for automation without reaching into CLI internals:

```typescript
import {
  publishEpoch,
  createBaseSepoliaPublisher,
  createRegistryPublisher,
  resolvePublishNetwork,
  loadOrCreateCheckpoint,
  backfillLeafUrisFromGraphql,
  buildLeafUriSidecar,
  publishLeafUriSidecarFromCheckpoint,
  resolveVerifierLeafUris,
  verifyUploadedLeaves,
  verifyGenesisPublish,
} from '@kargain/vincent-publish';
import type {
  PublishCheckpoint,
  VerifyGenesisPublishOptions,
  VerifyUploadedLeavesOptions,
} from '@kargain/vincent-publish';
```

Low-level Arweave primitives (`resolveLeafTxId`, `createArweaveGetLeafWithUris`,
`fetchLeafFromGateway`, `resolveVerifierLeafUris`, `discoverLeafUriSidecar`) live on
`@kargain/vincent/arweave` — use those for decoder clients; use `verifyGenesisPublish` +
checkpoint `leafUris` or sidecar URI for post-anchor publish verification.

For Base mainnet (or any viem `Chain`), use `createRegistryPublisher({ chain: base, rpcUrl, privateKeyHex })` from `@kargain/vincent-publish` (`base` from `viem/chains`). `createBaseSepoliaPublisher` remains a Base Sepolia default wrapper for testnet CLI flows.

## Leaf discovery (A-2b) — `@kargain/vincent/arweave`

The reference ANS-104 tag-query helper ships from the public `@kargain/vincent`
package. This tooling and the offline e2e tests consume it directly.

```typescript
import { createArweaveGetLeaf } from '@kargain/vincent/arweave';
import { createDecoder } from '@kargain/vincent/decoder';
```

## On-chain epoch read (client) — `@kargain/vincent/anchor`

Consumers can read anchored epochs without this publish package:

```typescript
import { createAnchorReader } from '@kargain/vincent/anchor';
import { baseSepolia } from 'viem/chains';

const reader = createAnchorReader({
  rpcUrl: process.env.BASE_SEPOLIA_RPC_URL!,
  chain: baseSepolia,
});
const anchored = await reader.getLatestEpoch(publisher);
// anchored.merkleRoot → createDecoder({ merkleRoot, getLeaf: createArweaveGetLeaf(...) })
```

The verify-only CLI uses `createBaseSepoliaReader` from this package (also exported
from the root); other consumers may use `@kargain/vincent/anchor` directly.

## Epoch publish orchestration

```typescript
import { publishEpoch, publishGenesis } from '@kargain/vincent-publish';
import type { Uploader, ChainPublisher } from '@kargain/vincent-publish';

// Auto: genesis if epochCount == 0, else incremental epoch N+1
const report = await publishEpoch({
  epoch,              // EpochBuild from compile()
  signerKeyHex,
  uploader,
  chainPublisher,     // publishEpoch(args) + readEpochCount + readLatestEpoch
});

// Foundational genesis only (fail-closed when epochCount > 0)
const genesisReport = await publishGenesis({
  epoch,
  signerKeyHex,
  uploader,
  chainPublisher,
});
```

`publishEpoch` reads `epochCount` on-chain. When zero: `parentRoot = 0x00…00`, `manifest.parent = null` (epoch 1). When greater than zero: reads the latest epoch's `merkleRoot` as `parentRoot` and sets `manifest.parent` to the same value as `sha256:<hex>`. Then: upload leaves → gzip JSONL → build+sign manifest → upload manifest → `publishEpoch` on-chain.

Sequence (genesis): upload leaves → gzip JSONL → build+sign manifest → upload manifest →
`publishEpoch` on-chain (`parent: null`, `parentRoot: 0x00…00`). Incremental epochs use the prior `merkleRoot` for both fields.

Adapter interfaces live in [`src/adapters/types.ts`](src/adapters/types.ts). Real adapters
(Irys devnet, Base Sepolia viem) are in [`src/adapters/`](src/adapters/). The Base
Sepolia adapter is also exercised against a real VincentAnchorRegistry deployment on
an in-process local Hardhat EVM.

### Founder-run CLI (not in `pnpm test`)

Requires [`publish/.env.example`](.env.example) variables (never commit keys):

```bash
cp publish/.env.example publish/.env   # fill in locally

pnpm --filter @kargain/vincent-publish build

# Auto: genesis if epochCount == 0, else incremental epoch N+1
pnpm --filter @kargain/vincent-publish publish:epoch -- --network base-sepolia --fixture genesis-mini
# alias: --devnet

# Foundational genesis only (fail-closed on used publisher)
pnpm --filter @kargain/vincent-publish publish:genesis -- --devnet --fixture genesis-mini
# or: --full  (reads the full seed and verifies all 20 committed VIN fixtures)
```

**Network flags** (required; mutually exclusive):

| Flag | Chain |
|------|-------|
| `--network base-sepolia` or `--devnet` | Base Sepolia (84532) + Irys devnet |
| `--network base` or `--mainnet` | Base mainnet (8453) + Irys mainnet bundler |

Mainnet defaults: shorter index-check delays, **re-upload disabled** (use `--allow-reupload`; full seed caps at 50 leaves unless `--max-reupload-leaves=N`).

Env vars:

| Variable | Purpose |
|----------|---------|
| `VINCENT_GENESIS_PRIVATE_KEY` | Signs manifest; pays Irys devnet + Base Sepolia gas |
| `BASE_SEPOLIA_RPC_URL` | Base Sepolia JSON-RPC (`--network base-sepolia` / `--devnet`) |
| `BASE_MAINNET_RPC_URL` | Base mainnet JSON-RPC (`--network base` / `--mainnet`) |
| `IRYS_GATEWAY_URL` | Optional data gateway; per-network default when unset (testnet vs mainnet) |
| `IRYS_GRAPHQL_URL` | Optional tag-query endpoint; defaults to `https://uploader.irys.xyz/graphql` |
| `VINCENT_IRYS_RECOVER_FUND_TX` | Optional Base Sepolia fund tx hash to register with Irys without sending a new payment |

Commented Base mainnet vars are in [`.env.example`](.env.example). Programmatic automation: `createIrysUploader({ chainId })`, `createRegistryPublisher({ chain })`, `resolvePublishNetwork`.

Irys uses three different endpoints:

- **Base Sepolia RPC** (`BASE_SEPOLIA_RPC_URL`) — pays for uploads via Irys `base-eth` on `devnet.irys.xyz`
- **Gateway** (`IRYS_GATEWAY_URL`) — fetches uploaded bytes by transaction id
- **GraphQL** (`IRYS_GRAPHQL_URL`) — discovers leaves by owner + tags (`uploader.irys.xyz`, not `arweave.devnet.irys.xyz`)

Registry: `0x06667DB3795C70F34b7517D1Af1217D3167BE241` on Base Sepolia (84532).

**Devnet caveat:** Irys devnet uploads are for validation only. Mainnet genesis is a separate later step (founder ops; dual-network CLI already accepts `--network base`).

Before uploading, the CLI compiles claims, quotes the full Irys upload cost (every leaf +
JSONL + manifest via `estimateFolderPrice`), funds the Irys account from **Base Sepolia**
when needed (waits for confirmation, registers the fund tx with the Irys bundler with
retries, then polls the Irys funded balance), and aborts when the wallet cannot cover the
quoted deficit plus gas reserve. If a prior Base Sepolia fund tx failed to register with
Irys, set `VINCENT_IRYS_RECOVER_FUND_TX` to that transaction hash. It also verifies the
private key, registry state (genesis: `epochCount == 0`; incremental: prior epoch readable),
Base Sepolia RPC and balance, Irys devnet uploader initialization, and the Irys GraphQL
tag-query schema. A failed preflight performs no uploads.

After uploads and before the on-chain anchor, the CLI polls GraphQL until every leaf is
indexed and Merkle-valid (per-leaf timeout; longer for `--full`). If indexing fails,
**no chain transaction is sent**.

### Full seed (`--full`) timing

The full seed compiles to **~13,900 leaves**. The founder CLI uploads leaves in **parallel** (default concurrency 10) and persists a local checkpoint after each successful leaf upload. Progress is logged continuously. Re-runs resume from the checkpoint file instead of re-uploading completed leaves.

| Flag | Purpose |
|------|---------|
| `--upload-only` | Upload leaves + JSONL + manifest; write checkpoint; skip index-check and anchor |
| `--anchor-only` | Skip leaf/artifact uploads; resolve JSONL/manifest from GraphQL or checkpoint; parallel index-check + anchor |
| `--retry-failed` | Re-upload **only** `failedLeafKeys` from the checkpoint; no index-check or anchor |
| `--upload-concurrency=N` | Parallel leaf uploads (default **10** for `--full`, **1** for mini fixtures) |
| `--index-check-concurrency=N` | Parallel GraphQL leaf verifications (default **20** for `--full`) |
| `--index-check-delay=MS` | Pause before index-check (default **180000** after upload; **0** for `--anchor-only`) |
| `--index-check-timeout=MS` | Per-leaf GraphQL poll budget (default **120000** for `--full`) |
| `--checkpoint-file=PATH` | Checkpoint path (default `publish/.vincent-publish-checkpoint.json`) |
| `--publish-leaf-uris-sidecar` | After index-check, opt-in upload `Kind=leaf-uris` bulk index (warn-only on failure) |
| `--allow-reupload` | Enable index-check re-upload on mainnet (off by default) |
| `--max-reupload-leaves=N` | Cap re-uploads during index-check (mainnet full default **50**) |
| `--leaf-uris-uri ar://...` | Verify-only: explicit sidecar URI |
| `--no-discover-leaf-uris-sidecar` | Verify-only: skip GraphQL `Kind=leaf-uris` discovery |

**Checkpoint file** (`.vincent-publish-checkpoint.json`, gitignored, schema v2) tracks each phase separately, plus optional JSONL/manifest URIs:

| Field | Meaning |
|-------|---------|
| `uploadedLeafKeys` | Leaves uploaded to Irys — upload-phase resume (`--full`, `--upload-only`) |
| `indexVerifiedLeafKeys` | Leaves confirmed by index-check — index-check resume (`--anchor-only`) |
| `failedLeafKeys` | Leaves that failed the last index-check — input for `--retry-failed` |
| `leafUris` | `leafKey → ar://txId` of the latest upload — used by the gateway fallback |
| `leafUriSidecarUri` | Optional `ar://` of published `Kind=leaf-uris` bulk index |

The fingerprint is `publisher + epochNumber + merkleRoot + jsonlSha256`; delete the file when switching builds or publishers. Old v1 checkpoints are migrated automatically (their `completedLeafKeys` become `indexVerifiedLeafKeys`). The CLI warns on stderr when index-verified leaves exist but `leafUris` is empty — run `backfill:leaf-uris` before `--anchor-only` or `--verify-only`.

**Index-check is non-fail-fast with gateway-first verification.** Both full publish and `--anchor-only` use the same per-leaf path: checkpoint `leafUris` → one-shot GraphQL tx-id lookup → re-upload + immediate gateway Merkle check → short last-resort GraphQL poll (**5s**). The long **120s** GraphQL poll per leaf is no longer the primary path. Before index-check on a fresh full upload, the CLI still waits **3 minutes** (bundler catch-up). Re-upload attempts are capped at **2** per leaf. Post-publish live verification waits until on-chain `latestEpoch.manifestUri` matches the report (fixes incremental epoch race).

| Mode | Initial delay | Re-upload attempts | Post re-upload delay |
|------|---------------|-------------------|----------------------|
| Full publish (devnet) | **3 min** bundler catch-up | **2** | **60s** (only if gateway miss after re-upload) |
| Full publish (mainnet) | **30s** | **2** (only with `--allow-reupload`) | **5s** |
| `--anchor-only` | **0** | **2** | **0** |

Preflight quotes only **remaining** upload bytes (leaves not in checkpoint + artifacts not yet valid on Irys). `--retry-failed` quotes only the failed leaf bytes. `--anchor-only` skips the Irys upload budget quote.

### Backfill `leafUris` from GraphQL

When the original upload did not record tx ids (e.g. checkpoint migrated from v1), bulk-query owner+epoch tags and merge into `leafUris` **without** re-uploading:

```bash
pnpm --filter @kargain/vincent-publish backfill:leaf-uris -- --devnet --epoch 2
```

This paginates `transactions(owners, tags: App+Epoch)` (no per-LeafKey filter), extracts `LeafKey` tags, and writes `leafUris` to the checkpoint. Run before `--anchor-only` when many leaves would otherwise re-upload.

### Leaf URI sidecar (third-party verifiers)

Publishers can upload a bulk `leafKey → ar://txId` index as a separate Arweave artifact tagged `Kind=leaf-uris` (bound to epoch fingerprint). Third parties use it with `createArweaveGetLeafWithUris` / `resolveVerifierLeafUris` without a local checkpoint.

```bash
# Export checkpoint leafUris to JSON
pnpm --filter @kargain/vincent-publish export:leaf-uris -- \
  --network base-sepolia --epoch 2 --out leaf-uris-epoch-2.json

# Backfill if needed, upload sidecar, save leafUriSidecarUri in checkpoint
pnpm --filter @kargain/vincent-publish publish:leaf-uris -- --network base-sepolia --epoch 2
# Skip GraphQL backfill when checkpoint leafUris is already populated:
#   ... publish:leaf-uris -- --devnet --epoch 2 --skip-backfill

# Opt-in auto-upload after index-check during full publish
pnpm --filter @kargain/vincent-publish publish:epoch -- --devnet --full --publish-leaf-uris-sidecar

# Verify-only: explicit sidecar URI or auto-discover via GraphQL Kind tag
pnpm --filter @kargain/vincent-publish publish:epoch -- --devnet --verify-only \
  --publisher <addr> --manifest-uri ar://... --leaf-uris-uri ar://...
```

`--verify-only` and `verifyGenesisPublish` resolve leaf hints in order: checkpoint `leafUris` → `--leaf-uris-uri` → GraphQL discovery (`Kind=leaf-uris`) → per-leaf GraphQL.

### Recovery playbook

When index-check reported failed leaves (e.g. devnet GraphQL never indexed ~20 of 14k):

```bash
# 0) Optional: backfill tx ids from GraphQL bulk query (avoids re-uploading already-uploaded leaves)
pnpm --filter @kargain/vincent-publish backfill:leaf-uris -- --devnet --epoch 2

# 1) Check all leaves; collect failures instead of stopping at the first one
caffeinate -i pnpm --filter @kargain/vincent-publish publish:epoch -- --devnet --full --anchor-only

# 2) Re-upload only the failed leaves recorded in the checkpoint
pnpm --filter @kargain/vincent-publish publish:epoch -- --devnet --full --retry-failed

# 3) Index-check the remaining leaves (gateway fallback picks up the fresh tx ids) + anchor
caffeinate -i pnpm --filter @kargain/vincent-publish publish:epoch -- --devnet --full --anchor-only
```

Step 3 skips everything already in `indexVerifiedLeafKeys`, so only the retried leaves are re-checked.

To resume a partial upload after interruption:

```bash
pnpm --filter @kargain/vincent-publish publish:epoch -- --devnet --full
# or upload without anchoring:
pnpm --filter @kargain/vincent-publish publish:epoch -- --devnet --full --upload-only
```

Delete `publish/.vincent-publish-checkpoint.json` only when the compiled epoch fingerprint changes or you intend to restart from scratch.

### Re-verify an existing epoch (verify-only)

To re-check a deployment without re-publishing (uses checkpoint `leafUris` for gateway-first decode when available):

```bash
pnpm --filter @kargain/vincent-publish publish:epoch -- --devnet --full --verify-only \
  --publisher 0xYourPublisher \
  --manifest-uri ar://YourManifestTxId
```

Post-publish verification waits until on-chain `latestEpoch.manifestUri` matches the report before comparing hashes. Requires the RPC URL for the selected network (`BASE_SEPOLIA_RPC_URL` for `--devnet`, `BASE_MAINNET_RPC_URL` for `--mainnet`). No private key unless set for other tooling.

## Fixtures

[`fixtures/manifest.json`](fixtures/manifest.json) — signed genesis-mini manifest (no `claims`,
`parent: null`). [`fixtures/golden.json`](fixtures/golden.json) — committed `manifestHash`.

Regenerate: `pnpm --filter @kargain/vincent-publish build && node publish/scripts/gen-fixture.mjs`

## Tests

```bash
pnpm --filter @kargain/vincent-publish test
pnpm validate:full-sim   # full seed (~14k leaves, 20 VIN fixtures; run pnpm generate:seed first)
```

Package scripts: `backfill:leaf-uris`, `export:leaf-uris`, `publish:leaf-uris`.

Includes offline mock `publishEpoch` / `publishGenesis` e2e (upload → chain → tag getLeaf decode → verifyEpoch).
`test/genesis-publish-simulation.test.ts` simulates the full founder CLI genesis path; `test/simulate-epoch-publish.ts` covers incremental epoch 2.
The default fast gate also deploys the real `VincentAnchorRegistry` bytecode to Hardhat EDR,
pins the mock publisher to the contract across success and revert scenarios, and runs the
genesis-mini pipeline and full epoch-2 incremental pipeline against the real local contract using funded ephemeral accounts (including `requireGenesis` abort with zero uploads).

The heavier full-seed simulation is opt-in and never contacts a live network:

```bash
pnpm validate:full-sim
```

It compiles `pipeline/.build/genesis-seed.jsonl`, uploads every leaf to the local Irys
mock, anchors the epoch in the real local contract, and decodes all 20 committed seed VINs.
