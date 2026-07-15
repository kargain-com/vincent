import { createHash } from 'node:crypto';
import { gunzipSync } from 'node:zlib';

import type { AnchorEpoch } from '@kargain/vincent/anchor';
import {
  parseClaim,
  parseManifest,
  toChecksumAddress,
  type Claim,
  type Manifest,
} from '@kargain/vincent/protocol';

import { manifestHash, verifySignedManifest } from './sign-manifest.js';

/** Minimal registry read surface for base-epoch fetch (injectable in tests). */
export interface BaseEpochReader {
  getEpoch(publisher: `0x${string}`, index: number): Promise<AnchorEpoch>;
}

export interface FetchBaseEpochOptions {
  reader: BaseEpochReader;
  gatewayUrl: string;
  /** Base publisher address (the anchored chain being snapshotted). */
  publisher: string;
  /** On-chain epoch index (0-based; manifest epoch is index + 1). */
  index: number;
  fetchImpl?: typeof fetch;
}

export interface BaseEpoch {
  anchor: AnchorEpoch;
  manifest: Manifest;
  claims: Claim[];
  jsonl: string;
}

function normalizeUrl(url: string): string {
  return url.replace(/\/+$/, '');
}

function arUriToGatewayUrl(gatewayUrl: string, uri: string): string {
  if (!uri.startsWith('ar://')) {
    throw new Error(`Base epoch: expected ar:// URI, got ${uri}`);
  }
  return `${normalizeUrl(gatewayUrl)}/${uri.slice('ar://'.length)}`;
}

function sha256ContentId(bytes: Uint8Array): string {
  return `sha256:${createHash('sha256').update(bytes).digest('hex')}`;
}

function isGzip(bytes: Uint8Array): boolean {
  return bytes.length >= 2 && bytes[0] === 0x1f && bytes[1] === 0x8b;
}

async function fetchBytes(
  fetchImpl: typeof fetch,
  url: string,
  label: string,
): Promise<Uint8Array> {
  const response = await fetchImpl(url);
  if (!response.ok) {
    throw new Error(`Base epoch: ${label} fetch failed (${String(response.status)})`);
  }
  return new Uint8Array(await response.arrayBuffer());
}

async function fetchManifest(
  fetchImpl: typeof fetch,
  gatewayUrl: string,
  anchor: AnchorEpoch,
): Promise<Manifest> {
  const bytes = await fetchBytes(
    fetchImpl,
    arUriToGatewayUrl(gatewayUrl, anchor.manifestUri),
    'manifest',
  );

  let json: unknown;
  try {
    json = JSON.parse(new TextDecoder().decode(bytes));
  } catch {
    throw new Error('Base epoch: manifest is not valid JSON');
  }

  const parsed = parseManifest(json);
  if (!parsed.ok) {
    throw new Error(`Base epoch: invalid manifest: ${parsed.error.message}`);
  }
  return parsed.value;
}

function verifyManifestAgainstAnchor(
  manifest: Manifest,
  anchor: AnchorEpoch,
  publisher: string,
  index: number,
): void {
  const hash = manifestHash(manifest);
  if (hash !== anchor.manifestHash) {
    throw new Error(
      `Base epoch: manifest hash mismatch (manifest ${hash}, on-chain ${anchor.manifestHash})`,
    );
  }

  const verified = verifySignedManifest(manifest);
  if (!verified.ok) {
    throw new Error(`Base epoch: manifest signature invalid (${verified.reason})`);
  }

  if (manifest.publisher !== toChecksumAddress(publisher)) {
    throw new Error(
      `Base epoch: manifest publisher ${manifest.publisher} does not match requested publisher ${publisher}`,
    );
  }

  if (manifest.epoch !== index + 1) {
    throw new Error(
      `Base epoch: manifest epoch ${String(manifest.epoch)} does not match on-chain index ${String(index)}`,
    );
  }

  if (manifest.dataset.merkleRoot !== anchor.merkleRoot) {
    throw new Error('Base epoch: manifest merkleRoot does not match on-chain merkleRoot');
  }

  if (manifest.dataset.jsonlSha256 !== anchor.jsonlSha256) {
    throw new Error('Base epoch: manifest jsonlSha256 does not match on-chain jsonlSha256');
  }
}

async function fetchDatasetJsonl(
  fetchImpl: typeof fetch,
  gatewayUrl: string,
  manifest: Manifest,
): Promise<string> {
  const errors: string[] = [];

  for (const uri of manifest.dataset.uris) {
    let bytes: Uint8Array;
    try {
      bytes = await fetchBytes(fetchImpl, arUriToGatewayUrl(gatewayUrl, uri), 'dataset');
    } catch (error) {
      errors.push(`${uri}: ${error instanceof Error ? error.message : String(error)}`);
      continue;
    }

    const jsonlBytes = isGzip(bytes) ? gunzipSync(bytes) : bytes;
    const hash = sha256ContentId(jsonlBytes);
    if (hash !== manifest.dataset.jsonlSha256) {
      // Fail closed: a reachable-but-corrupt dataset is a tamper signal, not a retry case.
      throw new Error(
        `Base epoch: dataset jsonlSha256 mismatch for ${uri} ` +
          `(fetched ${hash}, manifest ${manifest.dataset.jsonlSha256})`,
      );
    }
    return new TextDecoder().decode(jsonlBytes);
  }

  throw new Error(`Base epoch: no dataset URI reachable (${errors.join('; ')})`);
}

/** Parse a canonical epoch JSONL into validated claims (fail-closed per line). */
export function parseBaseClaims(jsonl: string): Claim[] {
  const claims: Claim[] = [];
  const lines = jsonl.split('\n');

  for (let i = 0; i < lines.length; i += 1) {
    const line = lines[i];
    if (line.length === 0) continue;

    let json: unknown;
    try {
      json = JSON.parse(line);
    } catch {
      throw new Error(`Base epoch: dataset line ${String(i + 1)} is not valid JSON`);
    }

    const parsed = parseClaim(json);
    if (!parsed.ok) {
      throw new Error(
        `Base epoch: dataset line ${String(i + 1)} is not a valid claim: ${parsed.error.message}`,
      );
    }
    claims.push(parsed.value);
  }

  return claims;
}

/**
 * Fetch an anchored base epoch by publisher + on-chain index, resolve its manifest
 * by URI, fetch the dataset JSONL from `dataset.uris`, and verify everything
 * fail-closed (manifest hash, signature, jsonlSha256, per-line claims).
 *
 * Never reads local build artifacts: an independent verifier only has the chain
 * and the gateway.
 */
export async function fetchBaseEpoch(options: FetchBaseEpochOptions): Promise<BaseEpoch> {
  if (!Number.isInteger(options.index) || options.index < 0) {
    throw new Error('Base epoch: index must be a non-negative integer');
  }

  const fetchImpl = options.fetchImpl ?? fetch;
  const anchor = await options.reader.getEpoch(
    options.publisher as `0x${string}`,
    options.index,
  );

  const manifest = await fetchManifest(fetchImpl, options.gatewayUrl, anchor);
  verifyManifestAgainstAnchor(manifest, anchor, options.publisher, options.index);

  const jsonl = await fetchDatasetJsonl(fetchImpl, options.gatewayUrl, manifest);
  const claims = parseBaseClaims(jsonl);

  return { anchor, manifest, claims, jsonl };
}
