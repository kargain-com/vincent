import { canonicalize } from './canonicalize-json.js';
import {
  buildLeafUriSidecarTransactionQuery,
  executeGraphqlWithOrderFallback,
  normalizeGraphqlUrl,
  normalizePublisherAddress,
} from './irys-graphql.js';
import { leafTxIdToUri } from './resolve-leaf-tx-id.js';

export const LEAF_URI_SIDECAR_SCHEMA_VERSION = 1 as const;
export const LEAF_URI_SIDECAR_KIND = 'leaf-uris' as const;

export interface LeafUriSidecar {
  schemaVersion: typeof LEAF_URI_SIDECAR_SCHEMA_VERSION;
  publisher: string;
  epoch: number;
  merkleRoot: string;
  jsonlSha256: string;
  leafUris: Record<string, string>;
  updatedAt: string;
}

export interface LeafUriSidecarFingerprint {
  publisher: string;
  epoch: number;
  merkleRoot: string;
  jsonlSha256: string;
}

export interface DiscoverLeafUriSidecarOptions {
  graphqlUrl: string;
  publisher: string;
  epoch: number;
  fetchImpl?: typeof fetch;
}

export interface DiscoverLeafUriSidecarResult {
  uri: string;
}

export interface FetchLeafUriSidecarOptions {
  gatewayUrl: string;
  uri: string;
  fetchImpl?: typeof fetch;
  fingerprint?: LeafUriSidecarFingerprint;
}

const SHA256_HASH_RE = /^sha256:[0-9a-f]{64}$/;
const AR_URI_RE = /^ar:\/\/.+/;

function assertSha256Hash(value: string, field: string): void {
  if (!SHA256_HASH_RE.test(value)) {
    throw new Error(`${field} must be sha256:<64 lowercase hex>`);
  }
}

function sortedLeafUris(leafUris: Record<string, string>): Record<string, string> {
  const sorted: Record<string, string> = {};
  for (const key of Object.keys(leafUris).sort((a, b) => a.localeCompare(b))) {
    sorted[key] = leafUris[key]!;
  }
  return sorted;
}

function parseLeafUris(value: unknown): Record<string, string> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw new Error('leafUris must be an object');
  }
  const uris: Record<string, string> = {};
  for (const [leafKey, uri] of Object.entries(value)) {
    if (typeof uri !== 'string' || !AR_URI_RE.test(uri)) {
      throw new Error(`leafUris[${leafKey}] must be an ar:// URI`);
    }
    uris[leafKey] = uri;
  }
  return uris;
}

/** Build a leaf-uris sidecar bound to an epoch fingerprint. */
export function buildLeafUriSidecar(
  fingerprint: LeafUriSidecarFingerprint,
  leafUris: Record<string, string>,
  updatedAt: string = new Date().toISOString(),
): LeafUriSidecar {
  assertSha256Hash(fingerprint.merkleRoot, 'merkleRoot');
  assertSha256Hash(fingerprint.jsonlSha256, 'jsonlSha256');
  if (!Number.isInteger(fingerprint.epoch) || fingerprint.epoch < 1) {
    throw new Error('epoch must be a positive integer');
  }

  return {
    schemaVersion: LEAF_URI_SIDECAR_SCHEMA_VERSION,
    publisher: normalizePublisherAddress(fingerprint.publisher),
    epoch: fingerprint.epoch,
    merkleRoot: fingerprint.merkleRoot,
    jsonlSha256: fingerprint.jsonlSha256,
    leafUris: sortedLeafUris(leafUris),
    updatedAt,
  };
}

/** Parse and validate sidecar JSON shape. */
export function parseLeafUriSidecar(value: unknown): LeafUriSidecar {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw new Error('leaf uri sidecar must be an object');
  }
  const record = value as Record<string, unknown>;
  if (record.schemaVersion !== LEAF_URI_SIDECAR_SCHEMA_VERSION) {
    throw new Error('unsupported leaf uri sidecar schemaVersion');
  }
  if (typeof record.publisher !== 'string' || record.publisher.length === 0) {
    throw new Error('leaf uri sidecar publisher is required');
  }
  if (typeof record.epoch !== 'number' || !Number.isInteger(record.epoch) || record.epoch < 1) {
    throw new Error('leaf uri sidecar epoch must be a positive integer');
  }
  if (typeof record.merkleRoot !== 'string' || typeof record.jsonlSha256 !== 'string') {
    throw new Error('leaf uri sidecar merkleRoot and jsonlSha256 are required');
  }
  if (typeof record.updatedAt !== 'string' || record.updatedAt.length === 0) {
    throw new Error('leaf uri sidecar updatedAt is required');
  }

  assertSha256Hash(record.merkleRoot, 'merkleRoot');
  assertSha256Hash(record.jsonlSha256, 'jsonlSha256');

  return {
    schemaVersion: LEAF_URI_SIDECAR_SCHEMA_VERSION,
    publisher: normalizePublisherAddress(record.publisher),
    epoch: record.epoch,
    merkleRoot: record.merkleRoot,
    jsonlSha256: record.jsonlSha256,
    leafUris: parseLeafUris(record.leafUris),
    updatedAt: record.updatedAt,
  };
}

/** Ensure sidecar matches the expected epoch fingerprint. */
export function validateLeafUriSidecar(
  sidecar: LeafUriSidecar,
  fingerprint: LeafUriSidecarFingerprint,
): void {
  const expected = buildLeafUriSidecar(fingerprint, {});
  if (sidecar.publisher !== expected.publisher) {
    throw new Error('leaf uri sidecar publisher mismatch');
  }
  if (sidecar.epoch !== expected.epoch) {
    throw new Error('leaf uri sidecar epoch mismatch');
  }
  if (
    sidecar.merkleRoot !== expected.merkleRoot ||
    sidecar.jsonlSha256 !== expected.jsonlSha256
  ) {
    throw new Error('leaf uri sidecar merkleRoot/jsonlSha256 mismatch');
  }
}

/** JCS-canonical JSON bytes for permanent upload. */
export function serializeLeafUriSidecar(sidecar: LeafUriSidecar): Uint8Array {
  return new TextEncoder().encode(canonicalize(sidecar));
}

function arUriToGatewayUrl(gatewayUrl: string, uri: string): string {
  if (!uri.startsWith('ar://')) {
    throw new Error(`Expected ar:// URI, got ${uri}`);
  }
  const id = uri.slice('ar://'.length);
  return `${gatewayUrl.replace(/\/+$/, '')}/${id}`;
}

/** Fetch and parse a sidecar from the gateway. */
export async function fetchLeafUriSidecar(
  options: FetchLeafUriSidecarOptions,
): Promise<LeafUriSidecar> {
  const fetchImpl = options.fetchImpl ?? fetch;
  const response = await fetchImpl(arUriToGatewayUrl(options.gatewayUrl, options.uri));
  if (!response.ok) {
    throw new Error(`Failed to fetch leaf uri sidecar: ${response.status}`);
  }
  const sidecar = parseLeafUriSidecar(await response.json());
  if (options.fingerprint !== undefined) {
    validateLeafUriSidecar(sidecar, options.fingerprint);
  }
  return sidecar;
}

/** Discover the newest leaf-uris sidecar for publisher+epoch via GraphQL. */
export async function discoverLeafUriSidecar(
  options: DiscoverLeafUriSidecarOptions,
): Promise<DiscoverLeafUriSidecarResult | null> {
  const fetchImpl = options.fetchImpl ?? fetch;
  const graphqlUrl = normalizeGraphqlUrl(options.graphqlUrl);
  const payload = await executeGraphqlWithOrderFallback(fetchImpl, graphqlUrl, (orderArgument) =>
    buildLeafUriSidecarTransactionQuery({
      publisher: options.publisher,
      epoch: options.epoch,
      orderArgument,
      first: 1,
    }),
  );

  if (payload.errors !== undefined && payload.errors.length > 0) {
    const message = payload.errors.map((error) => error.message).join('; ');
    throw new Error(`graphql query failed: ${message}`);
  }

  const edges = payload.data?.transactions?.edges;
  const txId = edges?.[0]?.node?.id;
  if (txId === undefined || txId.length === 0) {
    return null;
  }

  const uri = leafTxIdToUri(txId);
  return { uri };
}

/** Resolve leafUris from explicit map, sidecar URI, or GraphQL discovery. */
export async function resolveVerifierLeafUris(options: {
  publisher: string;
  epoch: number;
  merkleRoot: string;
  jsonlSha256: string;
  gatewayUrl: string;
  graphqlUrl: string;
  fetchImpl?: typeof fetch;
  leafUris?: Record<string, string>;
  leafUriSidecarUri?: string;
  discoverLeafUriSidecar?: boolean;
}): Promise<Record<string, string> | undefined> {
  const fingerprint: LeafUriSidecarFingerprint = {
    publisher: options.publisher,
    epoch: options.epoch,
    merkleRoot: options.merkleRoot,
    jsonlSha256: options.jsonlSha256,
  };
  const fetchImpl = options.fetchImpl ?? fetch;

  if (options.leafUris !== undefined && Object.keys(options.leafUris).length > 0) {
    return options.leafUris;
  }

  if (options.leafUriSidecarUri !== undefined) {
    const sidecar = await fetchLeafUriSidecar({
      gatewayUrl: options.gatewayUrl,
      uri: options.leafUriSidecarUri,
      fetchImpl,
      fingerprint,
    });
    return sidecar.leafUris;
  }

  if (options.discoverLeafUriSidecar === false) {
    return undefined;
  }

  const discovered = await discoverLeafUriSidecar({
    graphqlUrl: options.graphqlUrl,
    publisher: options.publisher,
    epoch: options.epoch,
    fetchImpl,
  });
  if (discovered === null) {
    return undefined;
  }

  const sidecar = await fetchLeafUriSidecar({
    gatewayUrl: options.gatewayUrl,
    uri: discovered.uri,
    fetchImpl,
    fingerprint,
  });
  return sidecar.leafUris;
}
