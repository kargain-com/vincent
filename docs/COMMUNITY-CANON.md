# Community Canon Profile

**Status:** non-normative. This document is a **client profile** on top of
[PROTOCOL.md](PROTOCOL.md) (which stays normative and unchanged): it describes
how community epochs published by individual verifiers (see
[PUBLISHER.md](PUBLISHER.md)) get accepted into a shared "community canon".
Nothing here changes the wire formats, the compiler, or the registry.

## 1. Wire review policy vs effective acceptance rule

The manifest wire format (§7.1) carries exactly:

```json
"reviewPolicy": { "minAccepts": 1, "reviewers": ["0x...", "..."] }
```

Community epochs declare **`minAccepts: 1`** with **`reviewers` = the endorse
attester addresses present in the attestation archive**. That is what the
publisher can honestly commit to on the wire: every accepted community claim
carries at least one valid `endorse` (§4.9) from one of those reviewers, and
the tooling fail-closes on anything less.

The **effective** acceptance rule is stricter and is deliberately **not** on
the wire, because it depends on reviewer roles that the manifest schema cannot
express:

| Reviewer role | Accepts required |
|---------------|------------------|
| Record verifier (verified the underlying record) | 1 |
| Independent reviewers | 2 |
| Proposer self-review | proposer + 1 other |

Enforcing that matrix is a **client-profile matter**: a client that adopts this
profile checks it against the published review archive (below) instead of
trusting `minAccepts` alone. Clients with different risk appetites may apply
different matrices to the same epochs without any protocol change.

## 2. The review-archive sidecar (non-normative)

Alongside each community epoch, the publisher uploads the assembler's
`attestation-archive.json` **byte-for-byte** as an ANS-104 item tagged:

```
App   = vincent
Epoch = <epoch number>
Kind  = review-archive
```

The sidecar is **not** part of the epoch commitment — it is not referenced by
the manifest, not hashed into `merkleRoot`/`jsonlSha256`, and clients MUST NOT
require it to decode. Its only purpose is auditability: it lets anyone check
review-policy compliance (which addresses endorsed which claim hash, plus
informational rejects and proposal snapshots) without contacting the publisher.
Discovery is by owner + tags, like leaf discovery (§7.2).

## 3. Acceptance bar for the community canon

An epoch enters the community canon of a client following this profile when
all of the following hold:

1. **Active-verifier publisher.** The epoch is anchored on the chain of a
   publisher recognized as an active Kargain verifier (an off-protocol roster;
   per-publisher chains are isolated per §8.1, so a bad publisher can be
   dropped without touching anyone else).
2. **Review-policy compliance is checkable from the archive.** The
   `Kind=review-archive` sidecar exists, validates (every endorse verifies per
   §4.9 and matches its claim hash), and satisfies the effective rule in §1
   for every community claim in the snapshot.
3. **At least 2 independent `rebuilt = true` confirmations.** Per §6, only
   `ManifestAttestation` with `rebuilt = true` carries compilation weight: the
   confirmer re-compiled the accepted claim set and reproduced the manifest's
   `jsonlSha256` and `merkleRoot` byte-for-byte.
4. **Most-confirmed root wins.** When competing snapshots exist for the same
   scope, clients follow the root with the most independent `rebuilt = true`
   confirmations; anchoring order breaks ties (earlier wins, consistent with
   §7.2 conflict ordering).

## 4. How a confirmer verifies a published epoch

A confirmer only needs the published npm packages — no repo checkout, no access
to the publisher, no Kargain artifacts:

```sh
npm install @kargain/vincent @kargain/vincent-compiler viem
```

```js
import { createAnchorReader } from '@kargain/vincent/anchor';
import { parseClaim, parseManifest } from '@kargain/vincent/protocol';
import { verifyEpoch } from '@kargain/vincent-compiler';
import { gunzipSync } from 'node:zlib';

// 1. Pin the epoch on-chain (publisher + index).
const reader = createAnchorReader({ chain: baseSepolia, rpcUrl: RPC_URL });
const anchor = await reader.getEpoch(publisher, index);

// 2. Resolve the manifest by URI and check it against the anchor.
const gw = (uri) => `https://testnet-gateway.irys.xyz/${uri.slice('ar://'.length)}`;
const manifest = parseManifest(await (await fetch(gw(anchor.manifestUri))).json()).value;
// (also verify manifestHash(manifest) === anchor.manifestHash and the signature —
// see @kargain/vincent/protocol manifestHash / verifyManifest)

// 3. Fetch the canonical JSONL from dataset.uris and parse the claims.
const raw = new Uint8Array(await (await fetch(gw(manifest.dataset.uris[0]))).arrayBuffer());
const jsonl = new TextDecoder().decode(raw[0] === 0x1f ? gunzipSync(raw) : raw);
const claims = jsonl.trimEnd().split('\n').map((line) => parseClaim(JSON.parse(line)).value);

// 4. Byte-rebuild: recompiles and compares jsonlSha256 + merkleRoot.
const result = verifyEpoch(manifest, claims);
// { ok: true }  =>  attest ManifestAttestation(manifestHash, rebuilt = true)
```

`verifyEpoch` verifies the manifest signature, recompiles the claim set with
the pinned `(compiler.name, compiler.version)` determinism contract, and
compares the rebuilt `jsonlSha256` and `merkleRoot` against
`manifest.dataset` (§7.2). A `{ ok: true }` result is what backs a
`rebuilt = true` attestation; anything else is `{ ok: false, reason }` and
must not be attested.

Clients MUST always verify `jsonlSha256`, `merkleRoot`, and per-leaf Merkle
proofs after every fetch (§8) regardless of this profile.
