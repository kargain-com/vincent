# @kargain/vincent-contracts

Private Hardhat 3 workspace package for Vincent on-chain contracts. Not published to npm.

## Contract

**VincentAnchorRegistry** — immutable, ownerless, permissionless, append-only per-publisher epoch notary.

- Source: [`src/VincentAnchorRegistry.sol`](src/VincentAnchorRegistry.sol)
- Interface: [`src/IVincentAnchorRegistry.sol`](src/IVincentAnchorRegistry.sol)

### Require / guard list

| Guard | Revert message |
|-------|----------------|
| First epoch and `parentRoot != 0` | `genesis parentRoot must be zero` |
| Subsequent epoch and `parentRoot != prior merkleRoot` | `parentRoot mismatch` |
| `merkleRoot == 0` | `merkleRoot must be non-zero` |
| `jsonlSha256 == 0` | `jsonlSha256 must be non-zero` |
| `manifestHash == 0` | `manifestHash must be non-zero` |
| `manifestUri` empty or > 256 chars | `invalid manifestUri length` |
| `getEpoch` index out of range | `no such epoch` |
| `latestEpoch` on empty chain | `no epochs` |
| Plain ETH transfer (no receive/fallback) | EVM revert |

## Setup

```bash
# From repo root
pnpm install
cp contracts/.env.example contracts/.env   # fill in RPC + keys (never commit)
```

## Commands

```bash
pnpm --filter @kargain/vincent-contracts build            # compile
pnpm --filter @kargain/vincent-contracts test            # run all tests
pnpm --filter @kargain/vincent-contracts compute-address # print CREATE2 address
pnpm --filter @kargain/vincent-contracts deploy:base-sepolia  # founder deploy
pnpm --filter @kargain/vincent-contracts verify:base-sepolia  # founder verify
```

## Environment variables

| Variable | Purpose |
|----------|---------|
| `BASE_SEPOLIA_RPC_URL` | Base Sepolia JSON-RPC endpoint |
| `DEPLOYER_PRIVATE_KEY` | Deployer key (never commit) |
| `ETHERSCAN_API_KEY` | Etherscan V2 unified API key (works for Basescan) |

See [`.env.example`](.env.example).

## Deterministic CREATE2 deployment

The registry deploys to the **same address on every EVM chain** via the canonical deterministic deployment proxy:

- Factory: `0x4e59b44847b379578588920cA78FbF26c0B4956C`
- Salt: `keccak256("kargain.vincent.VincentAnchorRegistry/v1")`

Run `pnpm compute-address` to print the predicted address, bytecode hash, and salt.

**Precomputed address:** `0x06667DB3795C70F34b7517D1Af1217D3167BE241`

## Deploy (founder-run, Base Sepolia only)

```bash
# 1. Set env vars in contracts/.env
# 2. Deploy via CREATE2
pnpm --filter @kargain/vincent-contracts deploy:base-sepolia

# 3. Verify on Basescan
pnpm --filter @kargain/vincent-contracts verify:base-sepolia

# 4. Update docs/contracts/README.md Verified column
```

Do **not** deploy to mainnet.

## Deployed addresses

Canonical address table: [`docs/contracts/README.md`](../docs/contracts/README.md).

## Client integration

Integrators read anchored epochs from the public library (not this workspace package):

```typescript
import { createAnchorReader } from '@kargain/vincent/anchor';
import { baseSepolia } from 'viem/chains';

const reader = createAnchorReader({
  rpcUrl: process.env.BASE_SEPOLIA_RPC_URL!,
  chain: baseSepolia,
});
const epoch = await reader.getLatestEpoch('0xYourPublisher');
// epoch.merkleRoot — sha256:… form for @kargain/vincent/decoder
```

Default registry address: `0x06667DB3795C70F34b7517D1Af1217D3167BE241` (CREATE2, same on every EVM chain). See [`docs/contracts/README.md`](../docs/contracts/README.md).

## Compiler settings (reproducible bytecode)

- solc 0.8.28
- optimizer: enabled, 200 runs
- evmVersion: cancun
- metadata.bytecodeHash: none
- No external libraries (no OpenZeppelin)
