# Vincent on-chain contracts

Canonical address table for Vincent smart contracts. This is the single source of truth for deployed registry addresses.

## VincentAnchorRegistry

Immutable, ownerless, permissionless, append-only per-publisher epoch notary. Records `merkleRoot`, `jsonlSha256`, `manifestHash`, and `manifestUri` per epoch, linked by `parentRoot`. Does not verify off-chain content — clients verify artifacts against the anchored hashes.

| Chain | Chain ID | Contract | Address | Verified |
|-------|----------|----------|---------|----------|
| Base Sepolia | 84532 | VincentAnchorRegistry | [`0x06667DB3795C70F34b7517D1Af1217D3167BE241`](https://sepolia.basescan.org/address/0x06667DB3795C70F34b7517D1Af1217D3167BE241) | Pending deploy |

> **Note:** The address above is precomputed via CREATE2 and is the same on every EVM chain once deployed with the canonical factory, salt, and bytecode. Update the **Verified** column after founder deploy + verify on Base Sepolia.

### Deterministic deployment parameters

| Parameter | Value |
|-----------|-------|
| CREATE2 factory | `0x4e59b44847b379578588920cA78FbF26c0B4956C` |
| Salt | `0xfd822afd75cb09e3d98f5cf0745fb9430e40d0c410ba3ac5d31ae377c4d764bf` |
| Salt derivation | `keccak256("kargain.vincent.VincentAnchorRegistry/v1")` |
| Bytecode hash | `0x9134e1ed28bf54735458d5d98275e34fe4bab70c243c8ec3bb9b229d09e24ee4` |
| Compiler | solc 0.8.28, optimizer 200 runs, evmVersion cancun, metadata.bytecodeHash none |

### Protocol note

This registry implements the richer per-publisher epoch chain described in the maintainer handoff (merkleRoot + jsonlSha256 + manifestHash + parentRoot lineage). It extends the simplified sketch in [PROTOCOL.md §9](../PROTOCOL.md#9-anchoring-and-canon-selection) (`anchor(bytes32 manifestHash, string uri)`). Integrators should use `IVincentAnchorRegistry` from `@kargain/vincent-contracts` (workspace-private; not published to npm).

## Development

See [`contracts/README.md`](../../contracts/README.md) for Hardhat setup, tests, deploy, and verify instructions.
