import type { MerkleProof } from '../decoder/leaf-types.js';
import { verifyLeaf } from '../decoder/verify-leaf.js';

export interface GatewayLeafPayload {
  leaf: string | Uint8Array;
  proof: MerkleProof;
}

function normalizeGatewayUrl(gatewayUrl: string): string {
  return gatewayUrl.replace(/\/+$/, '');
}

function txIdFromUri(uriOrTxId: string): string {
  return uriOrTxId.startsWith('ar://') ? uriOrTxId.slice('ar://'.length) : uriOrTxId;
}

function parseLeafPayload(body: string): GatewayLeafPayload {
  const parsed: unknown = JSON.parse(body);
  if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
    throw new Error('leaf data must be a JSON object');
  }
  const record = parsed as Record<string, unknown>;
  if (!('leaf' in record) || !('proof' in record)) {
    throw new Error('leaf data must contain leaf and proof');
  }
  const leaf = record.leaf;
  const proof = record.proof;
  if (typeof leaf !== 'string' && !(leaf instanceof Uint8Array)) {
    throw new Error('leaf must be a string or Uint8Array');
  }
  if (!Array.isArray(proof)) {
    throw new Error('proof must be an array');
  }
  return { leaf, proof: proof as MerkleProof };
}

/** Fetch a leaf payload directly by transaction id, bypassing GraphQL. */
export async function fetchLeafFromGateway(
  gatewayUrl: string,
  txIdOrUri: string,
  fetchImpl: typeof fetch = fetch,
): Promise<GatewayLeafPayload> {
  const url = `${normalizeGatewayUrl(gatewayUrl)}/${txIdFromUri(txIdOrUri)}`;
  const response = await fetchImpl(url);
  if (!response.ok) {
    throw new Error(`Gateway returned ${String(response.status)} for ${url}`);
  }
  return parseLeafPayload(await response.text());
}

export interface VerifyLeafFromGatewayOptions {
  gatewayUrl: string;
  txIdOrUri: string;
  merkleRoot: string;
  fetchImpl?: typeof fetch;
}

/**
 * True when the leaf is retrievable from the gateway by tx id and its Merkle
 * proof matches the epoch root. Any fetch/parse/proof failure returns false so
 * callers can fall back to GraphQL polling.
 */
export async function verifyLeafFromGateway(
  options: VerifyLeafFromGatewayOptions,
): Promise<boolean> {
  try {
    const payload = await fetchLeafFromGateway(
      options.gatewayUrl,
      options.txIdOrUri,
      options.fetchImpl,
    );
    return verifyLeaf(payload.leaf, payload.proof, options.merkleRoot).ok;
  } catch {
    return false;
  }
}
