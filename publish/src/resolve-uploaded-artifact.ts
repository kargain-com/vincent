import { createHash } from 'node:crypto';
import { gunzipSync } from 'node:zlib';

import { parseManifest } from '@kargain/vincent/protocol';

import { manifestHash } from './sign-manifest.js';

export type EpochArtifactType = 'jsonl' | 'manifest';

export interface ResolveUploadedArtifactOptions {
  gatewayUrl: string;
  graphqlUrl: string;
  publisher: string;
  epochNumber: number;
  artifactType: EpochArtifactType;
  fetchImpl?: typeof fetch;
}

interface GraphqlResponse {
  errors?: Array<{ message: string }>;
  data?: {
    transactions?: {
      edges?: Array<{ node?: { id?: string } }>;
    };
  };
}

function normalizeUrl(url: string): string {
  return url.replace(/\/+$/, '');
}

function buildArtifactQuery(
  publisher: string,
  epochNumber: number,
  artifactType: EpochArtifactType,
  orderArgument: 'sort: HEIGHT_DESC' | 'order: DESC',
): string {
  const owners = JSON.stringify([publisher.toLowerCase()]);
  const epochValue = JSON.stringify(String(epochNumber));
  const typeValue = JSON.stringify(artifactType);
  return `query {
  transactions(
    owners: ${owners}
    tags: [
      { name: "App", values: ["vincent"] }
      { name: "Epoch", values: [${epochValue}] }
      { name: "Type", values: [${typeValue}] }
    ]
    ${orderArgument}
    first: 1
  ) {
    edges {
      node {
        id
      }
    }
  }
}`;
}

function sortArgumentUnsupported(payload: GraphqlResponse): boolean {
  return payload.errors?.some((e) => e.message?.includes('Unknown argument "sort"')) === true;
}

function orderArgumentUnsupported(payload: GraphqlResponse): boolean {
  return payload.errors?.some((e) => e.message?.includes('Unknown argument "order"')) === true;
}

async function executeGraphql(
  fetchImpl: typeof fetch,
  graphqlUrl: string,
  query: string,
): Promise<GraphqlResponse> {
  const response = await fetchImpl(graphqlUrl, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ query }),
  });
  const body = (await response.json()) as GraphqlResponse;
  if (!response.ok && !sortArgumentUnsupported(body) && !orderArgumentUnsupported(body)) {
    throw new Error(`graphql request failed: ${response.status}`);
  }
  return body;
}

async function queryArtifactTxId(
  options: ResolveUploadedArtifactOptions,
): Promise<string | null> {
  const fetchImpl = options.fetchImpl ?? fetch;
  const graphqlUrl = normalizeUrl(options.graphqlUrl);
  const publisher = options.publisher.toLowerCase();

  let payload = await executeGraphql(
    fetchImpl,
    graphqlUrl,
    buildArtifactQuery(publisher, options.epochNumber, options.artifactType, 'order: DESC'),
  );
  if (orderArgumentUnsupported(payload)) {
    payload = await executeGraphql(
      fetchImpl,
      graphqlUrl,
      buildArtifactQuery(publisher, options.epochNumber, options.artifactType, 'sort: HEIGHT_DESC'),
    );
  }
  if (payload.errors !== undefined && payload.errors.length > 0) {
    throw new Error(payload.errors.map((e) => e.message).join('; '));
  }
  const id = payload.data?.transactions?.edges?.[0]?.node?.id;
  return typeof id === 'string' && id.length > 0 ? id : null;
}

function sha256ContentId(bytes: Uint8Array): string {
  return `sha256:${createHash('sha256').update(bytes).digest('hex')}`;
}

async function fetchBytes(
  fetchImpl: typeof fetch,
  gatewayUrl: string,
  txId: string,
): Promise<Uint8Array> {
  const response = await fetchImpl(`${normalizeUrl(gatewayUrl)}/${txId}`);
  if (!response.ok) {
    throw new Error(`artifact fetch failed: ${response.status}`);
  }
  return new Uint8Array(await response.arrayBuffer());
}

/** Resolve newest indexed jsonl/manifest tx for owner+epoch and verify content hash. */
export async function resolveUploadedArtifactUri(
  options: ResolveUploadedArtifactOptions & {
    expectedJsonlSha256?: string;
    expectedManifestHash?: string;
  },
): Promise<string | null> {
  const txId = await queryArtifactTxId(options);
  if (txId === null) return null;

  const fetchImpl = options.fetchImpl ?? fetch;
  const bytes = await fetchBytes(fetchImpl, options.gatewayUrl, txId);
  const uri = `ar://${txId}`;

  if (options.artifactType === 'jsonl') {
    if (options.expectedJsonlSha256 === undefined) return uri;
    const jsonlBytes = gunzipSync(bytes);
    if (sha256ContentId(jsonlBytes) !== options.expectedJsonlSha256) return null;
    return uri;
  }

  if (options.expectedManifestHash === undefined) return uri;
  const parsed = parseManifest(JSON.parse(new TextDecoder().decode(bytes)));
  if (!parsed.ok) return null;
  if (manifestHash(parsed.value) !== options.expectedManifestHash) return null;
  return uri;
}
