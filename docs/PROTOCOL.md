# Vincent protocol

**Version:** 0.1 (draft)
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

### 4.1 Wire format (`schemaVersion: "1.0"`)

```jsonc
{
  "schemaVersion": "1.0",
  "type": "wmi" | "vds-pattern" | "year-hint",
  "key": { /* type-specific, see 4.2 */ },
  "value": { /* type-specific, see 4.2 */ },
  "evidence": ["ar://<txid>", ...],        // optional
  "provenance": "<taxonomy, see 4.3>",
  "license": "CC0-1.0",                    // literal, required
  "supersedes": "sha256:...",              // optional: claim being corrected
  "contributor": "0x...",                  // EIP-55 checksummed address
  "signature": "0x..."                     // EIP-191, see section 5
}
```

Unknown top-level keys are invalid in v1.0 (fail closed). Empty optional keys are omitted, never null.

### 4.2 Claim types

**`wmi`** — maps a World Manufacturer Identifier to identity attributes.

```jsonc
"key":   { "wmi": "VF3" },
"value": { "manufacturer": "Peugeot", "country": "FR", "region": "EU" }
```

**`vds-pattern`** — maps a VDS pattern to one vehicle attribute.

```jsonc
"key":   { "wmi": "VF3", "positions": "4-8", "pattern": "LC***" },
"value": { "attribute": "model", "code": "308" }
```

- `positions`: inclusive 1-based range within positions 4–8.
- `pattern`: characters from the VIN alphabet plus `*` wildcard; length equals the range length.
- `attribute`: one of the canonical attribute enum — `model`, `series`, `bodyType`, `fuelType`, `driveType`, `transmission`, `engine`, `restraint`, `gvwrClass`, `plant`. Values are canonical English codes; localization is a client concern.
- One claim = one attribute. Compound statements are multiple claims.

**`year-hint`** — declares how a WMI resolves the 30-year model-year cycle (e.g., "position 7 numeric ⇒ 2010+ does not apply to this WMI").

```jsonc
"key":   { "wmi": "VF3" },
"value": { "cycleRule": "iso-unreliable" | "na-standard" }
```

### 4.3 Provenance taxonomy

- `regulatory/us-vpic` — imported from the NHTSA vPIC corpus (public domain).
- `community/observation` — derived from physical inspection of a real vehicle.
- `community/document` — derived from documents (CoC, type approval, service literature).
- `oem` — published by the manufacturer itself.

Clients and compilers MUST preserve provenance; consumers choose their own trust thresholds per provenance class.

### 4.4 Evidence rules

- Evidence is optional for `regulatory/*` and `oem`, expected for `community/*`.
- Evidence MUST NOT contain: full VINs (serial positions 12–17 masked), geolocation metadata, faces, license plates, or any personal data.
- Uploading evidence constitutes its CC0 dedication (the `license` field covers the entire claim document including evidence).

### 4.5 Privacy

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
