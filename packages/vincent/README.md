# @kargain/vincent

Pure, deterministic functions over the VIN string — normalization, validation, check digit, model year, and coarse region. WMI lookup is a separate entry point with layered loading. The core, WMI, decoder, and arweave entry points have **zero runtime dependencies**; the protocol entry adds `@noble/hashes` and `@noble/curves` for EIP-191 signing. Attribute decoding uses a Merkle-authenticated epoch dataset (32-byte root + per-WMI leaves); fetching leaves is the caller's concern.

```bash
npm install @kargain/vincent
```

## Entry points

| Entry | Approx. size (gzip) | Exports |
|-------|---------------------|---------|
| `@kargain/vincent` | ~3 KiB | Core deterministic APIs only — no WMI data |
| `@kargain/vincent/wmi` | ~40 KiB core + ~132 KiB extended on demand | `lookupWmi`, `WmiInfo` |
| `@kargain/vincent/protocol` | ~3 KiB entry + noble deps | JCS canonicalization, hashing, signing, parsing |
| `@kargain/vincent/decoder` | dependency-free | `createDecoder`, `decoder.origin`, `decoder.decode`, `matchExpression` |
| `@kargain/vincent/arweave` | dependency-free (global `fetch`) | `createArweaveGetLeaf`, `LeafNotFoundError` |

Extended WMI data (6-character codes for small manufacturers, position 3 = `9`) loads via dynamic `import()` only when needed. Mass-manufacturer 3-character WMIs load lazily on the first `lookupWmi` call.

## API

### `@kargain/vincent`

| Export | Description |
|--------|-------------|
| `normalizeVin(input)` | Trim, uppercase, strip whitespace and hyphens |
| `validateVin(input)` | Full validation with errors, warnings, check digit, region, and embedded `modelYear` |
| `computeCheckDigit(vin17)` | Compute position-9 check digit (throws on bad input) |
| `decodeModelYear(vin, options?)` | Decode model year from position 10 |
| `vinRegion(firstChar)` | Coarse ISO 3780 region from first character |
| `VIN_ALPHABET` | Standard VIN character set |
| `TRANSLITERATION` | Letter/digit values for check-digit math |
| `CHECK_DIGIT_WEIGHTS` | Position weights for check-digit computation |
| `YEAR_CODES` | Model-year code → base years (30-year cycle) |

### `@kargain/vincent/wmi`

| Export | Description |
|--------|-------------|
| `lookupWmi(vinOrWmi)` | `Promise<WmiInfo \| null>` — resolve WMI metadata (manufacturer, country, vehicle type) from a WMI or full VIN; awaits core decode and extended import when needed |

### `@kargain/vincent/protocol`

Implements [PROTOCOL.md](../../docs/PROTOCOL.md) v1.2 claim fact cores, attestations, JCS canonicalization, and EIP-191 signing. Runtime VIN matching and decoder resolution ship in `@kargain/vincent/decoder`.

**Claim types** (`schemaVersion` per type):

| Type | Version | Purpose |
|------|---------|---------|
| `wmi` | 1.0 | WMI → manufacturer / country / region |
| `year-hint` | 1.0 | Model-year cycle rule for a WMI |
| `vds-schema` | 1.1 | Declares a coding schema (identity = `claimHash`) |
| `vds-binding` | 1.1 | Binds WMI + year range to a schema |
| `vds-pattern` | 1.1 | Single decode rule (schema ref + `match{vds, vis?}`) |

| Export | Description |
|--------|-------------|
| `canonicalize(doc)` | RFC 8785 JCS canonical JSON string |
| `claimHash(claim)` | `sha256:<hex>` content id of the claim fact core |
| `manifestHash(manifest)` / `attestationHash(attestation)` | `sha256:<hex>` including `signature` |
| `signingPayload(doc)` | Canonical form excluding `signature` (manifests, attestations) |
| `attest(claimId, privateKey)` / `signManifest(manifest, privateKey)` | EIP-191 sign attestation or manifest |
| `verifyAttestation(att)` / `verifyManifest(manifest)` | Signature + EIP-55 verification |
| `parseClaim(json)` / `parseAttestation(json)` / `parseManifest(json)` | Fail-closed wire-format parsing |
| `parseMatchSegment(segment)` | Match grammar validation (§4.3); no VIN matching |
| `parseMatchExpression(match)` | Parse composite vds/vis match object |
| Types | `Claim`, `Attestation`, `Manifest`, `MatchToken`, … |

### `@kargain/vincent/decoder`

Implements [PROTOCOL.md](../../docs/PROTOCOL.md) §4.4 decoder resolution over a Merkle-authenticated epoch dataset. The client holds a 32-byte `merkleRoot` plus the bundled `./wmi` table. The library does not fetch network data or verify manifest signatures — pass an already-verified root and an async `getLeaf(wmi)` provider (untrusted; every leaf is verified against the root).

| Export | Description |
|--------|-------------|
| `createDecoder({ merkleRoot, getLeaf })` | Sync factory returning a `Decoder` |
| `decoder.origin(vin)` | Async WMI metadata from bundled `./wmi` + `vinRegion` (no leaf fetch) |
| `decoder.decode(vin, options?)` | Async full decode: fetch leaf + proof, verify Merkle inclusion, match patterns |
| `matchExpression(match, vin)` | Pure §4.3 matcher (vds@4, vis@10) |
| Types | `DecodeResult`, `GetLeaf`, `MerkleProof`, `OriginResult`, … |

Conflicts are never guessed: ambiguous model years and overlapping pattern values surface as `ambiguous` / `yearDependent` with candidate lists.

### `@kargain/vincent/arweave`

Reference `getLeaf` provider that discovers per-WMI leaves via ANS-104 tag queries against an Arweave gateway. It uses global `fetch` only (injectable for tests) and works in both Node and the browser. `getLeaf` is injectable, so `./arweave` is only the reference backend — callers may supply a mirror, an in-memory cache, or any alternate source. The provider does not verify Merkle inclusion; `createDecoder` verifies every returned leaf against the anchored root.

| Export | Description |
|--------|-------------|
| `createArweaveGetLeaf({ gatewayUrl, publisher, epoch, fetchImpl? })` | Returns a `getLeaf(leafKey)` that resolves `{ leaf, proof }` from the newest matching tagged transaction |
| `LeafNotFoundError` | Thrown when no transaction matches owner + `App`/`Epoch`/`LeafKey` tags (decoder maps to `unknown-wmi`) |
| Types | `ArweaveGetLeafOptions` |

## Usage

```ts
import { validateVin, decodeModelYear } from '@kargain/vincent';
import { lookupWmi } from '@kargain/vincent/wmi';

const result = validateVin('1-hgcm82633a004352');
// result.ok === true
// result.region === 'north-america'
// result.checkDigit.valid === true
// result.modelYear.best === 2003 (when cap leaves a single candidate)

const year = decodeModelYear(result.normalized);
// Same modelYear as result.modelYear; use standalone when options.now is needed

const wmi = await lookupWmi('1HG');
// { wmi: '1HG', manufacturer: 'AMERICAN HONDA MOTOR CO., INC.', ... }
```

### Protocol attest / verify

```ts
import { attest, verifyAttestation, claimHash, parseClaim } from '@kargain/vincent/protocol';

const claim = {
  schemaVersion: '1.0',
  type: 'wmi',
  key: { wmi: 'VF3' },
  value: { manufacturer: 'Peugeot', country: 'FR', vehicleType: 'Passenger Car', region: 'EU' },
  provenance: 'regulatory/us-vpic',
  license: 'CC0-1.0',
};

const id = claimHash(claim);
const att = attest(id, privateKeyHex);
const check = verifyAttestation(att);
// check.ok === true

const parsed = parseClaim(JSON.parse(jsonText));
// parsed.ok ? parsed.value : parsed.error
```

### Decoder

```ts
import { createDecoder } from '@kargain/vincent/decoder';
import { createArweaveGetLeaf } from '@kargain/vincent/arweave';

// `merkleRoot` — from a verified epoch manifest.
// `getLeaf` — the reference Arweave provider; swap in any mirror/cache/backend.
const decoder = createDecoder({
  merkleRoot: manifest.dataset.merkleRoot,
  getLeaf: createArweaveGetLeaf({
    gatewayUrl: 'https://arweave.net',
    publisher: manifest.publisher,
    epoch: manifest.epoch,
  }),
});

const origin = await decoder.origin('1FA12BBABG1234567');
// origin.wmi from bundled ./wmi + vinRegion (no network)

const result = await decoder.decode('1FA12BBABG1234567');
// result.attributes — model, bodyType, fuelType, plant, …
// result.year — resolved or ambiguous with candidates
```

## Data provenance

WMI lookup data is imported from the NHTSA vPIC standalone PostgreSQL plain dump (`vPICList_lite_2026_06.plain.zip`), with provenance class `regulatory/us-vpic`. Two compressed payloads are committed:

- `src/wmi-core.generated.ts` — 3-character WMIs (3,155 entries)
- `src/wmi-extended.generated.ts` — 6-character WMIs (9,749 entries)

Decompression uses vendored [tiny-inflate](https://github.com/devongovett/tiny-inflate) in `src/inflate.vendored.ts`. Core data inflates lazily on the first `lookupWmi` call; extended data loads via dynamic `import()` when a lookup needs a 6-character candidate with position 3 = `9`.

Regenerate locally with `pnpm generate:wmi` from the repo root. CI and package builds use the committed artifacts only — they never download source data.
