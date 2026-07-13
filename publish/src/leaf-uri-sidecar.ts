import {
  buildLeafUriSidecar,
  LEAF_URI_SIDECAR_KIND,
  serializeLeafUriSidecar,
  type LeafUriSidecar,
  type LeafUriSidecarFingerprint,
} from '@kargain/vincent/arweave';

import type { UploadTag, Uploader } from './adapters/types.js';
import type { PublishCheckpoint } from './publish-checkpoint.js';

export {
  buildLeafUriSidecar,
  discoverLeafUriSidecar,
  fetchLeafUriSidecar,
  LEAF_URI_SIDECAR_KIND,
  LEAF_URI_SIDECAR_SCHEMA_VERSION,
  parseLeafUriSidecar,
  resolveVerifierLeafUris,
  serializeLeafUriSidecar,
  validateLeafUriSidecar,
  type DiscoverLeafUriSidecarOptions,
  type DiscoverLeafUriSidecarResult,
  type FetchLeafUriSidecarOptions,
  type LeafUriSidecar,
  type LeafUriSidecarFingerprint,
} from '@kargain/vincent/arweave';

function appTag(): UploadTag {
  return { name: 'App', value: 'vincent' };
}

function epochTag(epochNumber: number): UploadTag {
  return { name: 'Epoch', value: String(epochNumber) };
}

function kindTag(): UploadTag {
  return { name: 'Kind', value: LEAF_URI_SIDECAR_KIND };
}

export function leafUriSidecarFingerprintFromCheckpoint(
  checkpoint: PublishCheckpoint,
): LeafUriSidecarFingerprint {
  return {
    publisher: checkpoint.publisher,
    epoch: checkpoint.epochNumber,
    merkleRoot: checkpoint.merkleRoot,
    jsonlSha256: checkpoint.jsonlSha256,
  };
}

export function buildLeafUriSidecarFromCheckpoint(
  checkpoint: PublishCheckpoint,
): LeafUriSidecar {
  return buildLeafUriSidecar(
    leafUriSidecarFingerprintFromCheckpoint(checkpoint),
    checkpoint.leafUris,
  );
}

export async function uploadLeafUriSidecar(options: {
  uploader: Uploader;
  sidecar: LeafUriSidecar;
  epochNumber: number;
}): Promise<{ uri: string; id: string }> {
  const receipt = await options.uploader.upload(serializeLeafUriSidecar(options.sidecar), [
    appTag(),
    epochTag(options.epochNumber),
    kindTag(),
  ]);
  return { uri: receipt.uri, id: receipt.id };
}

export async function publishLeafUriSidecarFromCheckpoint(options: {
  uploader: Uploader;
  checkpoint: PublishCheckpoint;
}): Promise<{ uri: string; id: string; sidecar: LeafUriSidecar }> {
  const sidecar = buildLeafUriSidecarFromCheckpoint(options.checkpoint);
  if (Object.keys(sidecar.leafUris).length === 0) {
    throw new Error('Cannot publish leaf uri sidecar: checkpoint leafUris is empty');
  }
  const upload = await uploadLeafUriSidecar({
    uploader: options.uploader,
    sidecar,
    epochNumber: options.checkpoint.epochNumber,
  });
  return { ...upload, sidecar };
}
