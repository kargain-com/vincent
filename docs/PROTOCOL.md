# Vincent protocol

**Version:** 1.1
**Status:** normative for all Vincent implementations once merged; breaking changes require a new `schemaVersion`.

Vincent is an open protocol for community-curated vehicle identification (VIN) data. It defines how facts about VIN encoding are contributed, reviewed, compiled into datasets, and anchored — so that any client can decode VINs offline and verify every byte it relies on.

## 1. Invariants

These hold for every version of the protocol. A change that violates one of them is not an upgrade; it is a different protocol.

1. **Canonical data lives in no chain.** Claims, manifests, and datasets are self-contained signed documents in content-addressed storage. Blockchains act only as interchangeable notaries (timestamping, ordering, discovery).
2. **Every fact is a signed claim with provable provenance and an immutable history.** Nothing is ever edited or deleted; corrections are new claims that supersede old ones at compile time.
3. **No irreplaceable components.** Any storage gateway, chain, publisher, or maintainer can disappear or be replaced without loss. A full permissionless fork of code, data, and reputation must always be possible.
4. **Code is MIT; data is CC0.** Every contribution flow must include an explicit CC0-1.0 dedication by the contributor.
5. **Decoding is a pure client-side function.** No API, server, or network call may sit in the critical path of decoding. Networks are used only to fetch and verify immutable artifacts.

## 2. Terminology

- **Claim** — the atomic unit of data: one signed statement about VIN encoding.
- **Contributor** — the Ethereum address that signs a claim.
- **Reviewer** — an address that publishes accept/reject attestations for claims.
- **Epoch** — a compiled snapshot: the set of accepted claims at a point in order.
- **Manifest** — the signed document describing an epoch.
- **Publisher** — the address that signs a manifest.
- **Dataset** — the canonical compiled artifact of an epoch (JSONL), plus derived caches (SQLite).
- **Anchor** — a record of a manifest hash in a blockchain registry.

## 3. Hashing and canonicalization

- Hash function: **SHA-256**. All identifiers are `sha256:<hex>` of a document's canonical bytes.
- Canonical form of every JSON document: **RFC 8785 (JCS)** — UTF-8, lexicographically sorted keys, no insignificant whitespace.
- The identity of a claim or manifest is the hash of its canonical form **including** the `signature` field. The *signing payload* is the canonical form **excluding** the `signature` field.

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
  "contributor": "0x...",                  // EIP-55 checksummed address
  "signature": "0x..."                     // EIP-191, see section 5
}
```

Unknown top-level keys are invalid (fail closed). Empty optional keys are omitted, never null. Required-nullable keys (currently only `vds-binding.key.yearTo`) are always present; `null` is a meaningful value (open-ended year range) and is included in canonical form.

Manifests use `schemaVersion: "1.0"` (see section 7.1). A manifest may reference claims with mixed claim `schemaVersion` minors under major 1; each claim self-describes.

### 4.2 Claim types

**`wmi`** (`schemaVersion: "1.0"`) — maps a World Manufacturer Identifier to identity attributes.

```jsonc
"key":   { "wmi": "VF3" },
"value": { "manufacturer": "Peugeot", "country": "FR", "region": "EU" }
```

**`vds-schema`** (`schemaVersion: "1.1"`) — declares a coding schema. Its `claimHash` is the schema's stable reference used by patterns and bindings. The declaration is intentionally minimal so its identity is stable — descriptive fields only, no patterns inside.

```jsonc
{
  "schemaVersion": "1.1",
  "type": "vds-schema",
  "key": { "name": "Ford car 2011 (vPIC 2225)" },   // descriptive; identity = claimHash
  "value": {},                                       // reserved; empty object in 1.1
  "provenance": "regulatory/us-vpic",
  "license": "CC0-1.0",
  "contributor": "0x...",
  "signature": "0x..."
}
```

**`vds-binding`** (`schemaVersion: "1.1"`) — binds a WMI and model-year range to a schema.

```jsonc
{
  "schemaVersion": "1.1",
  "type": "vds-binding",
  "key": {
    "wmi": "1FA",                 // 3- or 6-char WMI
    "yearFrom": 2011,             // inclusive model year
    "yearTo": 2011,               // inclusive; null = open-ended (still current)
    "schema": "sha256:..."        // a vds-schema claimHash
  },
  "value": {},                    // reserved; empty in 1.1
  "provenance": "regulatory/us-vpic",
  "license": "CC0-1.0",
  "supersedes": "sha256:...",     // optional — e.g. correcting a year range
  "contributor": "0x...",
  "signature": "0x..."
}
```

**`vds-pattern`** (`schemaVersion: "1.1"`) — a single decode rule inside a schema. One claim = one attribute.

```jsonc
{
  "schemaVersion": "1.1",
  "type": "vds-pattern",
  "key": {
    "schema": "sha256:...",       // a vds-schema claimHash
    "match": {
      "vds": "**BB",              // matches positions 4–8; grammar in 4.3
      "vis": "*G"                 // OPTIONAL; matches positions 10.. ; omit if unused
    }
  },
  "value": { "attribute": "model", "code": "Fusion" },
  "evidence": ["ar://..."],       // optional
  "provenance": "regulatory/us-vpic",
  "license": "CC0-1.0",
  "supersedes": "sha256:...",     // optional — corrects a pattern for ALL bound WMIs
  "contributor": "0x...",
  "signature": "0x..."
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

Decoder implementation is specified here; reference matcher ships in a later phase.

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

## 5. Signatures

- Scheme: **EIP-191 (personal_sign)** over the UTF-8 bytes of the JCS canonical form of the document without its `signature` field.
- Validity: recovered address MUST equal `contributor` (claims) or `publisher` (manifests).
- Verification is fully offline; no chain access is required.

## 6. Review and attestations

Reviews are published as **EAS (Ethereum Attestation Service)** attestations, but review semantics are chain-neutral: an attestation is meaningful on any chain where the reviewer chooses to publish it.

- Schema `ClaimReview`: `(bytes32 claimHash, uint8 verdict, string reasonUri)` — verdict: 1 accept, 2 reject.
- Schema `ManifestAttestation`: `(bytes32 manifestHash, bool rebuilt)` — `rebuilt = true` asserts the attester re-ran the compiler and reproduced `dataset.jsonlSha256` byte-for-byte. Only `rebuilt = true` attestations carry compilation weight.
- A claim is **accepted for an epoch** when it satisfies the epoch's stated review policy (see 7.2). Disputes are ordinary competing claims plus reviews; there is no separate dispute machinery in v0.1.

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
    "jsonlSha256": "...",                  // canonical artifact hash
    "sqliteSha256": "...",                 // derived cache hash (informative)
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
- **Determinism:** given `claims` and `(compiler.name, compiler.version)`, the canonical JSONL MUST be byte-reproducible. The JSONL is sorted by (claim type, key fields, claim hash). The SQLite artifact is a derived cache; its hash is informative, the JSONL hash is normative.
- **Supersession:** within an epoch's claim set, if claim B (`supersedes: A`) and A are both present, the compiler emits B only. Competing claims for the same key without supersession links are resolved by review weight, then by anchoring order (earlier wins); ties are compiler errors.
- Publishing is permissionless. Competing manifests for the same epoch height are legitimate; canon is chosen by the client (see 9).

## 8. Storage

- Default permanent store: **Arweave** (`ar://` URIs). Any content-addressed mirror (IPFS, HTTPS, torrent) is equally valid — the hash, not the location, is the identity.
- Clients MUST verify `jsonlSha256` / `sqliteSha256` (or the claim/manifest hash) after every fetch, regardless of source.

## 9. Anchoring and canon selection

- Registry contract (per chain): minimal, ownerless, append-only — `anchor(bytes32 manifestHash, string uri)` emitting an event. Anchoring the same manifest on multiple chains is encouraged.
- **Canon selection is a client policy, not a protocol rule.** Reference policy: among anchored manifests with valid signatures and reproducible lineage, prefer the one with the most `rebuilt = true` attestations from the client's trusted reviewer set (N-of-M); on ties, prefer the greater epoch, then the earliest anchor.
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
