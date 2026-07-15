import { gzipSync } from 'node:zlib';

import { compile } from '@kargain/vincent-compiler';
import type { AnchorEpoch } from '@kargain/vincent/anchor';
import {
  addressFromPrivateKey,
  attest,
  canonicalize,
  claimHash,
  signPersonalMessage,
  toChecksumAddress,
  type Claim,
} from '@kargain/vincent/protocol';

import { buildManifest } from '../src/build-manifest.js';
import { TEST_PRIVATE_KEY, TEST_PUBLISHER } from '../src/constants.js';
import type { BaseEpochReader } from '../src/fetch-base-epoch.js';
import { manifestHash, signManifest } from '../src/sign-manifest.js';
import { loadGenesisMiniClaims } from './helpers.js';

/** Hardhat account #0 — the foundational/base publisher in these fixtures. */
export const BASE_PUBLISHER_KEY = TEST_PRIVATE_KEY;
export const BASE_PUBLISHER = TEST_PUBLISHER;

/** Hardhat account #1 — the community verifier publishing on their own chain. */
export const COMMUNITY_PUBLISHER_KEY =
  '0x59c6995e998f97a5a0044966f0945389dc9e86dae88c7a8412f4603b6b78690d';
export const COMMUNITY_PUBLISHER = toChecksumAddress(
  addressFromPrivateKey(COMMUNITY_PUBLISHER_KEY),
);

/** Hardhat accounts #2 / #3 — community attesters. */
export const ATTESTER_KEY_1 =
  '0x5de4111afa1a4b94908f83103eb1f1706367c2e68ca870fc3fb9a804cdab365a';
export const ATTESTER_KEY_2 =
  '0x7c852118294e51e653712a81e05800f419141751be58f605c371e15141b007a6';
export const ATTESTER_1 = toChecksumAddress(addressFromPrivateKey(ATTESTER_KEY_1));
export const ATTESTER_2 = toChecksumAddress(addressFromPrivateKey(ATTESTER_KEY_2));

export const MOCK_GATEWAY_URL = 'https://mock.gateway.irys.test';

export function utf8(value: string): Uint8Array {
  return new TextEncoder().encode(value);
}

export const COMMUNITY_CLAIMS: Claim[] = [
  {
    schemaVersion: '1.0',
    type: 'wmi',
    key: { wmi: 'WVW' },
    value: {
      manufacturer: 'Volkswagen',
      country: 'DE',
      vehicleType: 'Passenger Car',
      region: 'EU',
    },
    provenance: 'community/document',
    license: 'CC0-1.0',
  },
  {
    schemaVersion: '1.0',
    type: 'wmi',
    key: { wmi: 'JHM' },
    value: {
      manufacturer: 'Honda',
      country: 'JP',
      vehicleType: 'Passenger Car',
      region: 'AS',
    },
    provenance: 'community/observation',
    license: 'CC0-1.0',
  },
];

/** JCS lines, one claim per line (assembler artifact shape, §7.2 order irrelevant to hashing). */
export function communityClaimsJsonl(claims: Claim[] = COMMUNITY_CLAIMS): string {
  return `${claims.map((claim) => canonicalize(claim)).join('\n')}\n`;
}

interface ArchiveReviewItem {
  review: Record<string, unknown>;
  eventId: string;
  authorPubkey: string;
  createdAt: number;
}

export interface ArchiveEntry {
  reviews: ArchiveReviewItem[];
  proposal?: Record<string, unknown>;
  [extra: string]: unknown;
}

function transportMeta(review: Record<string, unknown>): ArchiveReviewItem {
  return {
    review,
    eventId: 'ab'.repeat(32),
    authorPubkey: 'cd'.repeat(32),
    createdAt: 1_700_000_000,
  };
}

/** Signed reject review (same signing discipline as §4.9, non-protocol kind). */
export function makeReject(claimId: string, privateKey: string): Record<string, unknown> {
  const attester = toChecksumAddress(addressFromPrivateKey(privateKey));
  const unsigned = {
    schemaVersion: '1.0',
    claim: claimId,
    attester,
    kind: 'reject',
  };
  return { ...unsigned, signature: signPersonalMessage(canonicalize(unsigned), privateKey) };
}

/** Frozen Kargain archive wire: claimHash -> { reviews: [{ review, transport }], proposal? }. */
export function buildArchive(
  claims: Claim[] = COMMUNITY_CLAIMS,
  attesterKeys: string[] = [ATTESTER_KEY_1],
): Record<string, ArchiveEntry> {
  const archive: Record<string, ArchiveEntry> = {};
  for (const claim of claims) {
    const hash = claimHash(claim);
    archive[hash] = {
      reviews: attesterKeys.map((key) =>
        transportMeta(attest(hash, key) as unknown as Record<string, unknown>),
      ),
    };
  }
  return archive;
}

export function archiveBytes(archive: unknown): Uint8Array {
  return utf8(JSON.stringify(archive));
}

export interface BaseEpochFixture {
  anchor: AnchorEpoch;
  claims: Claim[];
  jsonl: string;
  /** txId -> served bytes (mutable for tamper tests). */
  files: Map<string, Uint8Array>;
  reader: BaseEpochReader;
  fetchImpl: typeof fetch;
}

/** Offline base-epoch fixture: genesis-mini compiled, signed, and served by txId. */
export function buildBaseEpochFixture(options?: {
  claims?: Claim[];
  gzipJsonl?: boolean;
}): BaseEpochFixture {
  const claims = options?.claims ?? loadGenesisMiniClaims();
  const built = compile(claims, {});
  if (!built.ok) {
    throw new Error(built.error.message);
  }

  const jsonlUri = 'ar://base-jsonl';
  const manifestUri = 'ar://base-manifest';
  const signed = signManifest(
    buildManifest({
      epoch: 1,
      parentRoot: null,
      merkleRoot: built.value.merkleRoot,
      jsonlSha256: built.value.jsonlSha256,
      uris: [jsonlUri],
      compiler: { name: 'vincent-compiler', version: '0.0.1' },
    }),
    BASE_PUBLISHER_KEY,
  );

  const anchor: AnchorEpoch = {
    epoch: 0,
    merkleRoot: built.value.merkleRoot,
    jsonlSha256: built.value.jsonlSha256,
    manifestHash: manifestHash(signed),
    parentRoot: null,
    timestamp: 1,
    manifestUri,
  };

  const gzipJsonl = options?.gzipJsonl ?? true;
  const files = new Map<string, Uint8Array>([
    ['base-manifest', utf8(JSON.stringify(signed))],
    ['base-jsonl', gzipJsonl ? gzipSync(utf8(built.value.jsonl)) : utf8(built.value.jsonl)],
  ]);

  const fetchImpl: typeof fetch = async (input) => {
    const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
    const txId = url.slice(url.lastIndexOf('/') + 1);
    const bytes = files.get(txId);
    if (bytes === undefined) {
      return new Response('not found', { status: 404 });
    }
    return new Response(Buffer.from(bytes));
  };

  return {
    anchor,
    claims,
    jsonl: built.value.jsonl,
    files,
    reader: { getEpoch: async () => anchor },
    fetchImpl,
  };
}
