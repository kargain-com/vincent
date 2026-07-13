# @kargain/vincent

Offline-first VIN validation and decoding per ISO 3779. The core library runs with no network and no runtime dependencies. For full attribute decoding, read the anchored Merkle root from the on-chain registry, fetch per-WMI leaves from Arweave (or any mirror), and verify every leaf against that root — no trusted data provider.

```bash
npm install @kargain/vincent
```

Install `viem` separately only if you use `@kargain/vincent/anchor` to read on-chain epochs.

## Entry points

| Entry | Purpose | Optional peer |
|-------|---------|---------------|
| `@kargain/vincent` | Normalize, validate, check digit, model year, region | — |
| `@kargain/vincent/wmi` | WMI lookup (lazy-loaded NHTSA vPIC data) | — |
| `@kargain/vincent/protocol` | JCS canonicalization, hashing, EIP-191 signing, wire parsing | `@noble/*` (bundled) |
| `@kargain/vincent/decoder` | Merkle-authenticated epoch decode over an injectable `getLeaf` | — |
| `@kargain/vincent/arweave` | Reference `getLeaf` via ANS-104 tag queries (global `fetch`) | — |
| `@kargain/vincent/anchor` | Read `VincentAnchorRegistry` epochs via JSON-RPC | `viem` |

Extended WMI data (6-character codes) loads via dynamic `import()` only when needed.

## Quick start (offline)

```ts
import { validateVin, decodeModelYear } from '@kargain/vincent';
import { lookupWmi } from '@kargain/vincent/wmi';

const result = validateVin('1-hgcm82633a004352');
// result.ok === true
// result.region === 'north-america'
// result.checkDigit.valid === true
// result.modelYear.best === 2003

const year = decodeModelYear(result.normalized);

const wmi = await lookupWmi('1HG');
// { wmi: '1HG', manufacturer: 'AMERICAN HONDA MOTOR CO., INC.', ... }
```

## Full decode (live)

End-to-end flow: on-chain anchor → Arweave leaf fetch → Merkle-verified decode.

```ts
import { createAnchorReader } from '@kargain/vincent/anchor';
import { createArweaveGetLeaf } from '@kargain/vincent/arweave';
import { createDecoder } from '@kargain/vincent/decoder';
import { baseSepolia } from 'viem/chains';

const publisher = '0xa0e58EC0f3dF4f127e9203A7fd6a494c483719B3';
const reader = createAnchorReader({
  rpcUrl: process.env.BASE_SEPOLIA_RPC_URL!,
  chain: baseSepolia,
});

const anchored = await reader.getLatestEpoch(publisher);
// anchored.merkleRoot is sha256:… — ready for createDecoder

const decoder = createDecoder({
  merkleRoot: anchored.merkleRoot,
  getLeaf: createArweaveGetLeaf({
    gatewayUrl: 'https://arweave.net',
    publisher,
    epoch: anchored.epoch,
  }),
});

const result = await decoder.decode('1FA12BBABG1234567');
// result.attributes — model, bodyType, fuelType, plant, …
```

`getLeaf` and the anchor reader are injectable references. Supply a cache, mirror, or alternate RPC transport instead of the reference Arweave gateway or default viem client. Leaf bytes live on Arweave (or your mirror); `createDecoder` verifies each leaf against the on-chain Merkle root, so the gateway does not need to be trusted for data integrity.

In the browser, pass a viem `publicClient` with your transport to `createAnchorReader({ chain, publicClient })` instead of `rpcUrl`.

## API reference

### `@kargain/vincent`

| Export | Description |
|--------|-------------|
| `normalizeVin(input)` | Trim, uppercase, strip whitespace and hyphens |
| `validateVin(input)` | Full validation with errors, warnings, check digit, region, model year |
| `computeCheckDigit(vin17)` | Compute position-9 check digit |
| `decodeModelYear(vin, options?)` | Decode model year from position 10 |
| `vinRegion(firstChar)` | Coarse ISO 3780 region |

### `@kargain/vincent/wmi`

| Export | Description |
|--------|-------------|
| `lookupWmi(vinOrWmi)` | `Promise<WmiInfo \| null>` — manufacturer, country, vehicle type |

### `@kargain/vincent/protocol`

Implements [PROTOCOL.md](../../docs/PROTOCOL.md) v1.2 — JCS canonicalization, `sha256:` content ids, EIP-191 signing, fail-closed parsing. Claim types: `wmi`, `year-hint`, `vds-schema`, `vds-binding`, `vds-pattern`.

Key exports: `canonicalize`, `claimHash`, `manifestHash`, `attest`, `verifyManifest`, `parseClaim`, `parseManifest`, `parseMatchExpression`.

### `@kargain/vincent/decoder`

Merkle-authenticated decode over an epoch dataset. Pass a verified `merkleRoot` and an async `getLeaf(wmi)` provider; every leaf is verified against the root.

| Export | Description |
|--------|-------------|
| `createDecoder({ merkleRoot, getLeaf })` | Returns `{ origin, decode }` |
| `decoder.origin(vin)` | WMI metadata from bundled `./wmi` (no network) |
| `decoder.decode(vin, options?)` | Full decode with Merkle verification |
| `matchExpression(match, vin)` | Pure §4.3 pattern matcher |

Conflicts are never guessed — ambiguous years and overlapping patterns return candidate lists.

### `@kargain/vincent/arweave`

Reference `getLeaf` via ANS-104 GraphQL tag queries (`App=vincent`, `Epoch`, `LeafKey`). Injectable `fetchImpl` for tests and custom runtimes.

| Export | Description |
|--------|-------------|
| `createArweaveGetLeaf({ gatewayUrl, graphqlUrl?, publisher, epoch, fetchImpl? })` | Returns `getLeaf(leafKey)` via GraphQL tag query + gateway fetch |
| `createArweaveGetLeafWithUris({ ...createArweaveGetLeaf options, leafUris? })` | Gateway-first `getLeaf`: known `ar://` tx id → gateway; else GraphQL |
| `resolveLeafTxId({ graphqlUrl, publisher, epoch, leafKey, fetchImpl? })` | One-shot newest tx id for a LeafKey tag (no polling) |
| `backfillLeafUrisFromGraphql({ graphqlUrl, publisher, epoch, ... })` | Bulk paginate owner+epoch tags → `leafKey → ar://txId` |
| `leafTxIdToUri(txId)` | Normalize tx id to `ar://` URI |
| `fetchLeafFromGateway(gatewayUrl, txIdOrUri, fetchImpl?)` | Direct gateway fetch by tx id (no GraphQL; does not verify Merkle) |
| `verifyLeafFromGateway({ gatewayUrl, txIdOrUri, merkleRoot, fetchImpl? })` | Gateway fetch + Merkle proof check against epoch root |
| `LeafNotFoundError` | No matching tagged transaction |

Does not verify Merkle inclusion — `createDecoder` does.

### `@kargain/vincent/anchor`

Read-only access to `VincentAnchorRegistry` (default address `0x06667DB3795C70F34b7517D1Af1217D3167BE241`, same CREATE2 address on every EVM chain). Requires `viem` as an optional peer.

| Export | Description |
|--------|-------------|
| `createAnchorReader({ rpcUrl?, chain, registryAddress?, publicClient? })` | Returns `{ getEpochCount, getEpoch, getLatestEpoch }` |
| `DEFAULT_REGISTRY_ADDRESS` | Canonical CREATE2 registry address |

Returned epochs use protocol `sha256:<hex>` form for hash fields (`merkleRoot` plugs directly into `createDecoder`). Genesis `parentRoot` (`0x00…00` on-chain) maps to `null`.

## Data provenance

WMI lookup data is imported from the NHTSA vPIC standalone PostgreSQL plain dump, with provenance class `regulatory/us-vpic`. Two compressed payloads are committed:

- `src/wmi-core.generated.ts` — 3-character WMIs
- `src/wmi-extended.generated.ts` — 6-character WMIs

Regenerate locally with `pnpm generate:wmi` from the repo root. CI and package builds use the committed artifacts only.

See [PROTOCOL.md](../../docs/PROTOCOL.md) for protocol and decoder semantics, and [docs/contracts/README.md](../../docs/contracts/README.md) for on-chain registry addresses.
