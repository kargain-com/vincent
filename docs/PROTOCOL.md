# Vincent protocol

**Version:** 1.2
**Status:** normative for all Vincent implementations once merged; breaking changes require a new `schemaVersion`.

Vincent is an open protocol for community-curated vehicle identification (VIN) data. It defines how facts about VIN encoding are contributed, reviewed, compiled into datasets, and anchored — so that any client can decode VINs offline and verify every byte it relies on.

## 1. Invariants

These hold for every version of the protocol. A change that violates one of them is not an upgrade; it is a different protocol.

1. **Canonical data lives in no chain.** Claims and the canonical JSONL dataset are unsigned content-addressed artifacts; manifests and attestations are signed. Blockchains act only as interchangeable notaries (timestamping, ordering, discovery).
2. **Every fact is a content-addressed claim with provable provenance and an immutable history.** Attestation is separate from the fact core. Nothing is ever edited or deleted; corrections are new claims that supersede old ones at compile time.
3. **No irreplaceable components.** Any storage gateway, chain, publisher, or maintainer can disappear or be replaced without loss. A full permissionless fork of code, data, and reputation must always be possible.
4. **Code is MIT; data is CC0.** Every contribution flow must include an explicit CC0-1.0 dedication by the contributor.
5. **Decoding is a pure client-side function.** No API, server, or network call may sit in the critical path of decoding. Networks are used only to fetch and verify immutable artifacts.

## 2. Terminology

- **Claim** — a content-addressed fact about VIN encoding (no inline signature).
- **Attestation** — a signed endorsement of a claim id (`claimHash`) by an Ethereum address.
- **Attester** — the address that signs an attestation.
- **Reviewer** — an address that publishes accept/reject attestations for claims.
- **Epoch** — a compiled snapshot: the set of accepted claims at a point in order.
- **Manifest** — the signed document describing an epoch; the publisher attests the whole claim set.
- **Publisher** — the address that signs a manifest.
- **Dataset** — the canonical compiled artifact of an epoch (JSONL of claim fact cores), plus derived caches (per-WMI leaves and Merkle root).
- **Anchor** — a record of a manifest hash in a blockchain registry.

## 3. Hashing and canonicalization

- Hash function: **SHA-256**. All identifiers are `sha256:<hex>` of a document's canonical bytes.
- Canonical form of every JSON document: **RFC 8785 (JCS)** — UTF-8, lexicographically sorted keys, no insignificant whitespace.
- The identity of a **claim** is `claimHash`: SHA-256 of the JCS canonical form of the claim fact core (no `signature`, no `contributor`). The dataset JSONL contains claim fact cores only.
- The identity of a **manifest** is the hash of its canonical form **including** the `signature` field.
- The *signing payload* for manifests and attestations is the canonical form **excluding** the `signature` field.

## 4. Claims

### 4.1 Wire format

```jsonc
{
  "schemaVersion": "1.0" | "1.1",          // per claim type, see 4.2 and 4.5
  "type": "wmi" | "vds-schema" | "vds-binding" | "vds-pattern" | "year-hint",
  "key": { /* type-specific, see 4.2 */ },
  "value": { /* type-specific, see 4.2 */ },
  "evidence": ["ar://<txid>", ...],        // optional
  "provenance": "<taxonomy, see 4.6>",
  "license": "CC0-1.0",                    // literal, required
  "supersedes": "sha256:...",              // optional: claim being corrected
}
```

Unknown top-level keys are invalid (fail closed). Empty optional keys are omitted, never null. Required-nullable keys (`vds-binding.key.yearTo`, `wmi.value.country`, `wmi.value.vehicleType`) are always present; `null` is a meaningful value and is included in canonical form.

Claims carry **no** `contributor` or `signature`. Attestation is provided separately (section 4.9) or via a signed epoch manifest (section 7). `provenance` is always required on each claim.

Manifests use `schemaVersion: "1.0"` (see section 7.1). A manifest may reference claims with mixed claim `schemaVersion` minors under major 1; each claim self-describes.

### 4.2 Claim types

**`wmi`** (`schemaVersion: "1.0"`) — maps a World Manufacturer Identifier to identity attributes.

```jsonc
"key":   { "wmi": "VF3" },              // 3- or 6-char WMI (6-char when position 3 = "9")
"value": { "manufacturer": "Peugeot", "country": "FR", "vehicleType": "Passenger Car", "region": "EU" }
```

`country` and `vehicleType` are required-nullable: always present on the wire; `null` when the source has no value (mirrors bundled WMI lookup semantics).

**`vds-schema`** (`schemaVersion: "1.1"`) — declares a coding schema. Its `claimHash` is the schema's stable reference used by patterns and bindings. The declaration is intentionally minimal so its identity is stable — descriptive fields only, no patterns inside.

```jsonc
{
  "schemaVersion": "1.1",
  "type": "vds-schema",
  "key": { "name": "Ford car 2011 (vPIC 2225)" },   // descriptive; identity = claimHash
  "value": {},                                       // reserved; empty object in 1.1
  "provenance": "regulatory/us-vpic",
  "license": "CC0-1.0"
}
```

**`vds-binding`** (`schemaVersion: "1.1"`) — binds a WMI and model-year range to a schema.

```jsonc
{
  "schemaVersion": "1.1",
  "type": "vds-binding",
  "key": {
    "wmi": "1FA",
    "yearFrom": 2011,
    "yearTo": 2011,
    "schema": "sha256:..."
  },
  "value": {},
  "provenance": "regulatory/us-vpic",
  "license": "CC0-1.0",
  "supersedes": "sha256:..."
}
```

**`vds-pattern`** (`schemaVersion: "1.1"`) — a single decode rule inside a schema. One claim = one attribute.

```jsonc
{
  "schemaVersion": "1.1",
  "type": "vds-pattern",
  "key": {
    "schema": "sha256:...",
    "match": { "vds": "**BB", "vis": "*G" }
  },
  "value": { "attribute": "model", "code": "Fusion" },
  "evidence": ["ar://..."],
  "provenance": "regulatory/us-vpic",
  "license": "CC0-1.0",
  "supersedes": "sha256:..."
}
```

- `attribute`: a well-formed camelCase token (validated at parse time). The genesis profile registry of recognized attributes is: `model`, `series`, `bodyType`, `fuelType`, `driveType`, `transmission`, `engine`, `engineCylinders`, `displacementL`, `plant`. The schema does not forbid deeper attributes; the community may add them later without another version bump. Vocabulary consistency is enforced by review, not by a closed parser enum.
- `value.code` — canonical English code for enumerated attributes; the literal published string for free values (engine model, plant city), provenance-tagged.
- One claim = one attribute. Compound statements are multiple claims.

**`year-hint`** (`schemaVersion: "1.0"`) — declares how a WMI resolves the 30-year model-year cycle (e.g., "position 7 numeric ⇒ 2010+ does not apply to this WMI"). Pairs with `vds-binding` year ranges for ISO-ambiguous WMIs.

```jsonc
"key":   { "wmi": "VF3" },
"value": { "cycleRule": "iso-unreliable" | "na-standard" }
```

### 4.3 Match grammar

A match segment is evaluated left-to-right against consecutive VIN positions:

- Literal VIN char (`A`–`Z` except I/O/Q, `0`–`9`) — the position must equal it.
- `*` — matches exactly one position (any allowed char).
- `[...]` — character class; matches one position that is any listed char; ranges via `-` allowed (`[0-9]`). No negation in 1.1.
- A segment need not cover all remaining positions; unspecified trailing positions are unconstrained.

Anchoring: `match.vds` at position 4; `match.vis` at position 10 (when present). A claim matches a VIN when every present segment matches.

Resolution when several patterns match: existing epoch rules only (supersession → review weight → anchoring order; section 7.2). Specificity does NOT auto-win — conflicts are resolved at review time and recorded, never guessed by the decoder.

### 4.4 Decoder resolution

Given a VIN and a model year, over the compiled accepted claim set:

1. Resolve WMI (3-char, or 6-char when position 3 = "9") → `wmi` attributes.
2. Find `vds-binding` claims for that WMI whose `[yearFrom, yearTo]` contains the year (`null` `yearTo` = open). Collect their `schema` refs.
3. For each bound schema, select `vds-pattern` claims whose `match` applies to the VIN. Emit their attribute/value pairs.
4. The matcher is pure and total: same (VIN, year, claim set) ⇒ same result.

Reference implementation: `@kargain/vincent/decoder` (`createDecoder({ merkleRoot, getLeaf })`).

### 4.5 VDS compatibility and versioning

- The VDS claim types (`vds-schema`, `vds-binding`, `vds-pattern`) use `schemaVersion: "1.1"`. `wmi` and `year-hint` stay `"1.0"`. A manifest may mix claim schemaVersions; each claim self-describes.
- Parsers reject unknown majors; 1.0 and 1.1 share major 1, both readable (section 10).
- No pre-existing v1.0 `vds-pattern` data exists, so no migration is needed.
- Old epochs remain readable forever (section 10).

### 4.6 Provenance taxonomy

- `regulatory/us-vpic` — imported from the NHTSA vPIC corpus (public domain).
- `community/observation` — derived from physical inspection of a real vehicle.
- `community/document` — derived from documents (CoC, type approval, service literature).
- `oem` — published by the manufacturer itself.

Clients and compilers MUST preserve provenance; consumers choose their own trust thresholds per provenance class.

### 4.7 Evidence rules

- Evidence is optional for `regulatory/*` and `oem`, expected for `community/*`.
- Evidence MUST NOT contain: full VINs (serial positions 12–17 masked), geolocation metadata, faces, license plates, or any personal data.
- Uploading evidence constitutes its CC0 dedication (the `license` field covers the entire claim document including evidence).

### 4.8 Privacy

Claims derived from real transactions (e.g., marketplace verifications) MUST be batched and published with randomized delay, and MUST NOT carry timestamps of the underlying event. The claim's only time reference is its anchoring order.

### 4.9 Attestations

Attestations are signed endorsements of claim ids, published separately from the dataset JSONL (EAS, off-chain files, etc.).

```jsonc
{
  "schemaVersion": "1.0",
  "claim": "sha256:...",           // claimHash of the endorsed fact core
  "attester": "0x...",             // EIP-55 checksummed address
  "kind": "endorse",               // endorsement kind (1.2: only "endorse")
  "signature": "0x..."             // EIP-191 over JCS form excluding signature
}
```

Verification: recovered address MUST equal `attester`. Bulk epoch imports rely on the manifest publisher's signature over `dataset.jsonlSha256`; individual claims may also carry attestations.

## 5. Signatures

- Scheme: **EIP-191 (personal_sign)** over the UTF-8 bytes of the JCS signing payload (canonical form excluding `signature`).
- **Claims:** fact cores are unsigned; no per-claim signature on the wire.
- **Attestations:** `attester` and `signature` are required; recovered address MUST equal `attester`.
- **Manifests:** `publisher` and `signature` are required; recovered address MUST equal `publisher`.
- Verification is fully offline; no chain access is required.

## 6. Review and acceptance

Acceptance derives from attestations plus the epoch's declared review policy. Reviews are attestations referencing `claimHash`.

EAS (Ethereum Attestation Service) schemas remain chain-neutral:

- Schema `ClaimReview`: `(bytes32 claimHash, uint8 verdict, string reasonUri)` — verdict: 1 accept, 2 reject.
- Schema `ManifestAttestation`: `(bytes32 manifestHash, bool rebuilt)` — `rebuilt = true` asserts the attester re-ran the compiler and reproduced `dataset.jsonlSha256` and `merkleRoot` byte-for-byte. Only `rebuilt = true` attestations carry compilation weight.

A claim is **accepted for an epoch** when it satisfies the epoch's stated review policy (see 7.2). A bulk regulatory epoch is attested by the manifest publisher's signature over the claim set and `jsonlSha256`. Disputes are ordinary competing claims plus attestations; there is no separate dispute machinery in v0.1.

There is no contributor staking. Sybil pressure, if it materializes, may be addressed in a future version by a refundable anti-spam deposit; any such change requires a new schemaVersion.

## 7. Epochs and manifests

### 7.1 Manifest wire format

```jsonc
{
  "schemaVersion": "1.0",
  "epoch": 3,
  "parent": "sha256:...",                  // manifest hash of epoch 2; genesis: null
  "reviewPolicy": { "minAccepts": 1, "reviewers": ["0x...", ...] },
  "claims": ["sha256:...", ...],           // accepted claims, lexicographically sorted
  "compiler": { "name": "vincent-compiler", "version": "1.2.0" },
  "dataset": {
    "jsonlSha256": "...",                  // canonical artifact hash (normative)
    "merkleRoot": "...",                   // Merkle root over per-WMI leaf digests (normative)
    "uris": ["ar://...", ...]              // at least one; mirrors welcome
  },
  "publisher": "0x...",
  "signature": "0x..."
}
```

`compiler.name` is an opaque protocol identifier of the compiler implementation — not an npm package name or other packaging artifact. The `(compiler.name, compiler.version)` pair identifies the exact implementation required for byte-reproducible builds. The reference implementation identifier is `"vincent-compiler"`.

### 7.2 Rules

- Epochs are **event-driven**: a publisher may build whenever new accepted claims exist. There is no calendar.
- `reviewPolicy` is declared per manifest; clients decide whether a policy is acceptable to them. Genesis policy: claims with `regulatory/us-vpic` provenance are accepted by import; community claims require reviewer accepts.
- **Determinism:** given `claims` and `(compiler.name, compiler.version)`, the canonical JSONL MUST be byte-reproducible. The JSONL contains claim fact cores, sorted by (claim type, key fields, claim hash). **Per-WMI leaves** and the **Merkle root** are derived caches; every leaf digest and `merkleRoot` MUST match a rebuild from the same claims. The JSONL hash and Merkle root are committed in the manifest.
- **Leaf + Merkle model:** one self-contained **leaf** per WMI key: `{ wmi, bindings[{ yearFrom, yearTo, schemaRef }], schemas: { schemaRef: { patterns } } }` (JCS-canonical JSON, content-addressed by `sha256:<hex>`). Leaves are ordered by WMI. A Merkle tree is built over leaf digests with RFC 6962–style domain separation: leaf node = `SHA256(0x00 || rawDigest)`, internal = `SHA256(0x01 || left || right)`; when a level has an odd count, the last node is carried up unchanged. The client holds only the 32-byte `merkleRoot`. Per VIN it fetches one leaf + Merkle proof, verifies inclusion against the anchored root, and decodes locally. Origin (make/country/region) comes from the bundled WMI table + `vinRegion` — fully offline, no leaf fetch. **Oversized WMIs** (canonical leaf &gt; 128 KiB) are split into year-range **sub-leaves** at keys `wmi#pN` plus a **partition manifest** at key `wmi`; the decoder resolves the manifest, verifies sub-leaves against both `merkleRoot` and manifest `leafHash`, and merges before decode.
- **Compilation validation:** the compiler validates each claim for parse-time well-formedness only. Epoch integrity is verified by manifest signature plus JSONL/Merkle rebuild (`verifyEpoch`); no per-claim `ecrecover`.
- **Supersession:** within an epoch's claim set, if claim B (`supersedes: A`) and A are both present, the compiler emits B only. Competing claims for the same key without supersession links are resolved by review weight, then by anchoring order (earlier wins); ties are compiler errors.
- Publishing is permissionless. Competing manifests for the same epoch height are legitimate; canon is chosen by the client (see 9).

## 8. Storage

- Default permanent store: **Arweave** (`ar://` URIs). Any content-addressed mirror (IPFS, HTTPS, torrent) is equally valid — the hash, not the location, is the identity.
- Clients MUST verify `jsonlSha256` and `merkleRoot` (and each fetched leaf via its Merkle proof against the anchored root) after every fetch, regardless of source.

## 9. Anchoring and canon selection

- **Anchor contract:** `VincentAnchorRegistry` — immutable, ownerless, permissionless, append-only per-publisher epoch registry. Each publisher maintains an independent epoch chain. Entry point: `publishEpoch(merkleRoot, jsonlSha256, manifestHash, parentRoot, manifestUri)`. The publisher's transaction is the attestation; there is no owner, admin, upgrade path, or custody.
- **Epoch structure:** Each epoch commits `merkleRoot`, `jsonlSha256`, `manifestHash`, and `manifestUri` (typically `ar://…`), linked by `parentRoot`. Genesis epochs require `parentRoot = 0`; each subsequent epoch must reference the prior epoch's `merkleRoot`.
- **Per-publisher chains:** Clients choose one or more trusted publisher addresses. A publisher may publish once and discard its signing key (**keyless genesis**); that chain is then frozen forever — trustless and unowned.
- **Off-chain verification:** The registry records content hashes and timestamps only; it cannot verify Arweave content, leaf inclusion, or manifest signatures. Clients MUST verify off-chain: fetch manifest by URI → confirm content hash equals `manifestHash` → verify publisher signature → read `merkleRoot` → verify each fetched leaf via its Merkle proof against `merkleRoot` (see section 8).
- **Multi-chain notaries:** EVM chains are interchangeable notaries. The registry deploys at the same CREATE2 address on every EVM chain (canonical deterministic-deployment proxy at `0x4e59b44847b379578588920cA78FbF26c0B4956C`). Publishers are encouraged to anchor the same `merkleRoot` per epoch on multiple chains.
- **Canon selection is a client policy, not a protocol rule.** Reference policy: among epochs from the client's trusted publisher(s), prefer a pinned epoch or the latest epoch with valid signature and reproducible lineage; growth is additive via overlay publishers, while genesis chains remain frozen.
- Loss or censorship of any single chain affects discovery only; data, signatures, and other anchors remain intact.

## 10. Versioning

- `schemaVersion` follows the wire documents, not the packages. Parsers MUST reject documents with an unknown major version and MUST NOT guess.
- Major version 1 accepts claim minors `"1.0"` and `"1.1"`; each claim type declares its required minor (see section 4.2).
- Old epochs remain readable forever: compilers and decoders keep read support for all released major versions.

## 11. Security considerations

- **False claims:** bounded by review policy, provenance filtering, and the advisory nature of decoding (end users confirm; marketplace verification remains the trust layer above).
- **Malicious publisher:** cannot forge data (hashes, signatures) — only publish a manifest nobody attests; canon selection ignores it.
- **Gateway compromise:** defeated by mandatory hash verification.
- **Reviewer collusion:** mitigated by client-side N-of-M choice of reviewer sets and by permissionless forking; reputation (EAS history) is address-bound and portable to forks.
- **Spam:** accepted-claim review is the gate; reserve measure per section 6.

## 12. References

- ISO 3779 (VIN content and structure); 49 CFR 565 (US VIN requirements)
- RFC 8785 — JSON Canonicalization Scheme
- EIP-191 — signed data standard; EIP-55 — address checksums
- EAS — Ethereum Attestation Service
- NHTSA vPIC — https://vpic.nhtsa.dot.gov (public-domain seed corpus)
