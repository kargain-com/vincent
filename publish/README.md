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
| `BASE_SEPOLIA_RPC_URL` | Base Sepolia JSON-RPC for the anchor registry |
| `IRYS_SEPOLIA_RPC_URL` | Ethereum Sepolia JSON-RPC for Irys uploads (default: `https://ethereum-sepolia-rpc.publicnode.com`; do not use `rpc.sepolia.org`) |
| `IRYS_GATEWAY_URL` | Optional data gateway; defaults to `https://gateway.irys.xyz` |
| `IRYS_GRAPHQL_URL` | Optional tag-query endpoint; defaults to `https://uploader.irys.xyz/graphql` |

Irys uses three different endpoints:

- **Ethereum Sepolia RPC** (`IRYS_SEPOLIA_RPC_URL`) — pays for uploads via the Irys SDK
- **Gateway** (`IRYS_GATEWAY_URL`) — fetches uploaded bytes by transaction id
- **GraphQL** (`IRYS_GRAPHQL_URL`) — discovers leaves by owner + tags (`uploader.irys.xyz`, not `arweave.devnet.irys.xyz`)

Registry: `0x06667DB3795C70F34b7517D1Af1217D3167BE241` on Base Sepolia (84532).

**Devnet caveat:** Irys devnet uploads are for validation only. Mainnet genesis is a separate later step.

Before uploading, the CLI compiles claims, quotes the full Irys upload cost (every leaf +
JSONL + manifest via `estimateFolderPrice`), and aborts when Ethereum Sepolia wallet balance
plus Irys funded balance cannot cover the quoted cost (with a safety buffer). It also verifies
the private key, registry state (genesis: `epochCount == 0`; incremental: prior epoch readable),
Base Sepolia RPC and balance, Irys devnet uploader initialization, and the Irys GraphQL
tag-query schema. A failed preflight performs no uploads.

After uploads and before the on-chain anchor, the CLI polls GraphQL until every leaf is
indexed and Merkle-valid. If indexing fails, **no chain transaction is sent**.

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
