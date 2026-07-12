# @kargain/vincent-publish

Offline epoch manifest build, sign, and genesis publish tooling (Vincent Phase A).

This package produces a signed epoch **manifest** that commits `dataset.merkleRoot` and
`dataset.jsonlSha256`. The manifest is what `VincentAnchorRegistry.publishEpoch` anchors
on-chain (`manifestHash` + `manifestUri`).

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

The reference ANS-104 tag-query helper now ships from the public `@kargain/vincent`
package. This tooling and the offline e2e tests consume it directly.

```typescript
import { createArweaveGetLeaf } from '@kargain/vincent/arweave';
import { createDecoder } from '@kargain/vincent/decoder';
```

## Genesis publish orchestration (A-2c)

```typescript
import { publishGenesis } from '@kargain/vincent-publish';
import type { Uploader, ChainPublisher } from '@kargain/vincent-publish';

const report = await publishGenesis({
  epoch,              // EpochBuild from compile()
  signerKeyHex,
  uploader,           // upload(data, tags) => { id, uri }
  chainPublisher,     // publishEpoch(args) => txHash
});
// report: { publisher, jsonlUri, manifestUri, manifestHash, txHash, leafCount, manifest }
```

Sequence: upload leaves → gzip JSONL → build+sign manifest → upload manifest →
`publishEpoch` on-chain (genesis: `parent: null`, `parentRoot: 0x00…00`).

Adapter interfaces live in [`src/adapters/types.ts`](src/adapters/types.ts). Real adapters
(Irys devnet, Base Sepolia viem) are in [`src/adapters/`](src/adapters/) and used only
by the founder CLI.

### Founder-run CLI (not in `pnpm test`)

Requires [`publish/.env.example`](.env.example) variables (never commit keys):

```bash
cp publish/.env.example publish/.env   # fill in locally

pnpm --filter @kargain/vincent-publish build
pnpm --filter @kargain/vincent-publish publish:genesis -- --devnet --fixture genesis-mini
# or: --full  (reads pipeline/.build/genesis-seed.jsonl; chain+manifest verify only)
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

Before uploading, the CLI verifies the private key, `epochCount == 0`, Base Sepolia RPC
and balance, Ethereum Sepolia RPC and Irys payment balance, Irys devnet uploader
initialization, and the Irys GraphQL tag-query schema. A failed preflight performs no uploads.

After uploads and before the on-chain anchor, the CLI polls GraphQL until every leaf is
indexed and Merkle-valid. If indexing fails, **no chain transaction is sent**.

### Re-verify an existing genesis (one-shot wallets)

Genesis is one epoch per publisher address. To re-check a deployment without re-publishing:

```bash
pnpm --filter @kargain/vincent-publish publish:genesis -- --devnet --verify-only \
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

Includes offline mock `publishGenesis` e2e (upload → chain → tag getLeaf decode → verifyEpoch).
`test/genesis-publish-simulation.test.ts` simulates the full founder CLI path — preflight,
upload, on-chain anchor, manifest verification, and fixture VIN decode — without gas or live RPC.
