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

The verify-only CLI uses an internal read-only adapter; integrators should use `@kargain/vincent/anchor` directly.

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
pnpm --filter @kargain/vincent-publish publish:epoch -- --devnet --fixture genesis-mini

# Foundational genesis only (fail-closed on used publisher)
pnpm --filter @kargain/vincent-publish publish:genesis -- --devnet --fixture genesis-mini
# or: --full  (reads the full seed and verifies all 20 committed VIN fixtures)
```

Env vars:

| Variable | Purpose |
|----------|---------|
| `VINCENT_GENESIS_PRIVATE_KEY` | Signs manifest; pays Irys devnet + Base Sepolia gas |
| `BASE_SEPOLIA_RPC_URL` | Base Sepolia JSON-RPC for anchor registry **and** Irys `base-eth` uploads (same as Kargain) |
| `IRYS_GATEWAY_URL` | Optional data gateway; defaults to `https://gateway.irys.xyz` |
| `IRYS_GRAPHQL_URL` | Optional tag-query endpoint; defaults to `https://uploader.irys.xyz/graphql` |
| `VINCENT_IRYS_RECOVER_FUND_TX` | Optional Base Sepolia fund tx hash to register with Irys without sending a new payment |

Irys uses three different endpoints:

- **Base Sepolia RPC** (`BASE_SEPOLIA_RPC_URL`) — pays for uploads via Irys `base-eth` on `devnet.irys.xyz`
- **Gateway** (`IRYS_GATEWAY_URL`) — fetches uploaded bytes by transaction id
- **GraphQL** (`IRYS_GRAPHQL_URL`) — discovers leaves by owner + tags (`uploader.irys.xyz`, not `arweave.devnet.irys.xyz`)

Registry: `0x06667DB3795C70F34b7517D1Af1217D3167BE241` on Base Sepolia (84532).

**Devnet caveat:** Irys devnet uploads are for validation only. Mainnet genesis is a separate later step.

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

**Checkpoint file** (`.vincent-publish-checkpoint.json`, gitignored, schema v2) tracks each phase separately, plus optional JSONL/manifest URIs:

| Field | Meaning |
|-------|---------|
| `uploadedLeafKeys` | Leaves uploaded to Irys — upload-phase resume (`--full`, `--upload-only`) |
| `indexVerifiedLeafKeys` | Leaves confirmed by index-check — index-check resume (`--anchor-only`) |
| `failedLeafKeys` | Leaves that failed the last index-check — input for `--retry-failed` |
| `leafUris` | `leafKey → ar://txId` of the latest upload — used by the gateway fallback |

The fingerprint is `publisher + epochNumber + merkleRoot + jsonlSha256`; delete the file when switching builds or publishers. Old v1 checkpoints are migrated automatically (their `completedLeafKeys` become `indexVerifiedLeafKeys`).

**Index-check is non-fail-fast with a gateway fallback.** Before index-check on full publishes (after a fresh upload), the CLI waits **3 minutes** (bundler catch-up) then verifies leaves in parallel (default concurrency 20). **`--anchor-only` skips this delay** (leaves were uploaded earlier). Progress logs every **25** verified leaves and starts from the checkpoint count on resume. On GraphQL timeout the CLI **re-uploads** the leaf, records its tx URI, and immediately verifies the leaf **directly from the gateway by tx id** (Merkle-proof check, no GraphQL); only on a gateway miss does it wait **90s** and retry GraphQL (up to **6** attempts for `--anchor-only`). A leaf that exhausts all attempts is added to `failedLeafKeys` and the check **continues with the remaining leaves**. When any leaf fails, the run ends with a summary and **no chain transaction is sent** — fix with `--retry-failed` below.

Preflight quotes only **remaining** upload bytes (leaves not in checkpoint + artifacts not yet valid on Irys). `--retry-failed` quotes only the failed leaf bytes. `--anchor-only` skips the Irys upload budget quote.

### Recovery playbook

When index-check reported failed leaves (e.g. devnet GraphQL never indexed ~20 of 14k):

```bash
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

To re-check a deployment without re-publishing:

```bash
pnpm --filter @kargain/vincent-publish publish:epoch -- --devnet --verify-only \
  --publisher 0xYourPublisher \
  --manifest-uri ar://YourManifestTxId
```

Requires `BASE_SEPOLIA_RPC_URL` only (no private key unless set for other tooling).

## Fixtures

[`fixtures/manifest.json`](fixtures/manifest.json) — signed genesis-mini manifest (no `claims`,
`parent: null`). [`fixtures/golden.json`](fixtures/golden.json) — committed `manifestHash`.

Regenerate: `pnpm --filter @kargain/vincent-publish build && node publish/scripts/gen-fixture.mjs`

## Tests

```bash
pnpm --filter @kargain/vincent-publish test
```

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
