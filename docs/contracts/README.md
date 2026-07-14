# Vincent on-chain contracts

Canonical address table for Vincent smart contracts. This is the single source of truth for deployed registry addresses.

## VincentAnchorRegistry

Immutable, ownerless, permissionless, append-only per-publisher epoch notary. Records `merkleRoot`, `jsonlSha256`, `manifestHash`, and `manifestUri` per epoch, linked by `parentRoot`. Does not verify off-chain content — clients verify artifacts against the anchored hashes.

| Chain | Chain ID | Contract | Address | Verified |
|-------|----------|----------|---------|----------|
| Base Sepolia | 84532 | VincentAnchorRegistry | [`0x06667DB3795C70F34b7517D1Af1217D3167BE241`](https://sepolia.basescan.org/address/0x06667DB3795C70F34b7517D1Af1217D3167BE241) | Deployed · Exact Match (2026-07-14) |
| Base | 8453 | VincentAnchorRegistry | [`0x06667DB3795C70F34b7517D1Af1217D3167BE241`](https://basescan.org/address/0x06667DB3795C70F34b7517D1Af1217D3167BE241) | Not deployed |

> **Note:** The address is precomputed via CREATE2 and is the same on every EVM chain once deployed with the canonical factory, salt, and bytecode. Sepolia: bytecode live; Basescan Exact Match; test publisher `0xcf1eb0e7ed453ed266bf90e7c09e0e4769580b77` has `epochCount = 2` (index 1 = full US seed root `0xbb435fb8…`). Update this table after mainnet deploy + verify.

### Reading epochs (client library)

Integrators can read anchored epochs via `@kargain/vincent/anchor`:

```typescript
import { createAnchorReader } from '@kargain/vincent/anchor';
import { baseSepolia } from 'viem/chains';

const reader = createAnchorReader({
  rpcUrl: process.env.BASE_SEPOLIA_RPC_URL!,
  chain: baseSepolia,
});

const epoch = await reader.getLatestEpoch('0xYourPublisher');
// epoch.merkleRoot — sha256:… form, ready for @kargain/vincent/decoder
```

`viem` is an optional peer of `@kargain/vincent`; only the `./anchor` subpath imports it. Pass `registryAddress` to override the default CREATE2 address when testing against a local deployment.

### Publish preflight safety

Genesis publish tooling (`@kargain/vincent-publish`) checks `epochCount == 0` for the publisher wallet **before any upload** via [`assertGenesisPublisherAvailable`](../../publish/src/assert-genesis-publisher.ts). Preflight runs in [`preflightGenesisPublish`](../../publish/src/preflight-genesis-publish.ts) and is invoked by the founder CLI before leaves, JSONL, or manifest bytes are uploaded. Irys devnet uploads use **`base-eth` on Base Sepolia** (same RPC as the anchor registry). A failed preflight performs no uploads. See [`publish/README.md`](../../publish/README.md) for the full checklist.

### Deterministic deployment parameters

| Parameter | Value |
|-----------|-------|
| CREATE2 factory | `0x4e59b44847b379578588920cA78FbF26c0B4956C` |
| Salt | `0xfd822afd75cb09e3d98f5cf0745fb9430e40d0c410ba3ac5d31ae377c4d764bf` |
| Salt derivation | `keccak256("kargain.vincent.VincentAnchorRegistry/v1")` |
| Bytecode hash | `0x9134e1ed28bf54735458d5d98275e34fe4bab70c243c8ec3bb9b229d09e24ee4` |
| Compiler | solc 0.8.28, optimizer 200 runs, evmVersion cancun, metadata.bytecodeHash none |

### Protocol note

This registry implements the richer per-publisher epoch chain described in the maintainer handoff (merkleRoot + jsonlSha256 + manifestHash + parentRoot lineage). It extends the simplified sketch in [PROTOCOL.md §9](../PROTOCOL.md#9-anchoring-and-canon-selection) (`anchor(bytes32 manifestHash, string uri)`).

- **TypeScript ABI / interface:** `IVincentAnchorRegistry` in `@kargain/vincent-contracts` (workspace-private; not published to npm)
- **Runtime epoch reader:** `@kargain/vincent/anchor` (`createAnchorReader`) — published; optional `viem` peer

## Development

See [`contracts/README.md`](../../contracts/README.md) for Hardhat setup, tests, deploy, and verify instructions.
