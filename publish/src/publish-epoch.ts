import type { EpochBuild } from '@kargain/vincent-compiler';
import { addressFromPrivateKey, toChecksumAddress } from '@kargain/vincent/protocol';
import { gzipSync } from 'node:zlib';

import type { ChainPublisher, PublishGenesisReport, UploadTag, Uploader } from './adapters/types.js';
import { sha256ContentIdToBytes32 } from './adapters/sha256-bytes32.js';
import { assertGenesisPublisherAvailable } from './assert-genesis-publisher.js';
import { buildManifest } from './build-manifest.js';
import {
  DEFAULT_FULL_UPLOAD_CONCURRENCY,
  DEFAULT_GENESIS_REVIEW_POLICY,
} from './constants.js';
import {
  preflightEpochPublish,
  type EpochPreflightOptions,
} from './preflight-genesis-publish.js';
import {
  formatLeafUriBackfillHint,
  loadOrCreateCheckpoint,
  needsLeafUriBackfillHint,
  saveCheckpoint,
  setLeafUriSidecarUri,
  updateCheckpointUris,
  type PublishCheckpoint,
} from './publish-checkpoint.js';
import { publishLeafUriSidecarFromCheckpoint } from './leaf-uri-sidecar.js';
import { resolveEpochParent, type EpochChainReader } from './resolve-epoch-parent.js';
import { resolveUploadedArtifactUri } from './resolve-uploaded-artifact.js';
import { manifestHash, signManifest } from './sign-manifest.js';
import { uploadEpochLeaves } from './upload-epoch-leaves.js';
import {
  verifyUploadedLeaves,
  type VerifyUploadedLeavesOptions,
} from './verify-uploaded-leaves.js';

const DEFAULT_COMPILER = { name: 'vincent-compiler', version: '0.0.1' } as const;

export interface PublishEpochPhases {
  uploadLeaves?: boolean;
  uploadArtifacts?: boolean;
  indexCheck?: boolean;
  anchor?: boolean;
}

export interface LeafIndexCheckOptions {
  gatewayUrl: string;
  graphqlUrl: string;
  fetchImpl?: typeof fetch;
  timeoutMs?: number;
  pollIntervalMs?: number;
  sleep?: VerifyUploadedLeavesOptions['sleep'];
  delayMs?: number;
  concurrency?: number;
  reuploadOnFailure?: boolean;
  maxReuploadAttempts?: number;
  maxReuploadLeaves?: number;
  postReuploadDelayMs?: number;
  gatewayFallback?: boolean;
  skipGraphqlPoll?: boolean;
  onReupload?: VerifyUploadedLeavesOptions['onReupload'];
  onDelay?: VerifyUploadedLeavesOptions['onDelay'];
  onLeafFailed?: VerifyUploadedLeavesOptions['onLeafFailed'];
}

export interface LeafUriSidecarOptions {
  /** Upload Kind=leaf-uris bulk index after index-check (opt-in). */
  publish?: boolean;
  onWarning?: (message: string) => void;
}

export interface PublishEpochDeps {
  epoch: EpochBuild;
  signerKeyHex: string;
  uploader: Uploader;
  chainPublisher: ChainPublisher & EpochChainReader;
  compiler?: { name: string; version: string };
  requireGenesis?: boolean;
  preflight?: EpochPreflightOptions;
  leafIndexCheck?: LeafIndexCheckOptions;
  phases?: PublishEpochPhases;
  /** 'failed-only' restricts leaf uploads to checkpoint.failedLeafKeys (--retry-failed). */
  uploadScope?: 'all' | 'failed-only';
  uploadConcurrency?: number;
  checkpointPath?: string;
  onProgress?: (progress: PublishEpochProgress) => void;
  onCheckpointLoaded?: (summary: CheckpointLoadSummary) => void;
  onHint?: (message: string) => void;
  leafUriSidecar?: LeafUriSidecarOptions;
}

export interface CheckpointLoadSummary {
  checkpoint: PublishCheckpoint;
  totalLeaves: number;
  uploadedLeaves: number;
  indexVerifiedLeaves: number;
  failedLeaves: number;
  needsLeafUriBackfill: boolean;
}

export type PublishEpochReport = PublishGenesisReport;

export type PublishEpochPhase =
  | 'leaves'
  | 'jsonl'
  | 'manifest'
  | 'index-check'
  | 'anchor';

export interface PublishEpochProgress {
  phase: PublishEpochPhase;
  completed: number;
  total: number;
  skipped?: number;
  uploaded?: number;
  checkpointCount?: number;
}

function utf8Bytes(value: string): Uint8Array {
  return new TextEncoder().encode(value);
}

function epochTag(epochNumber: number): UploadTag {
  return { name: 'Epoch', value: String(epochNumber) };
}

function appTag(): UploadTag {
  return { name: 'App', value: 'vincent' };
}

function resolvePhases(
  phases: PublishEpochPhases | undefined,
  leafIndexCheck: LeafIndexCheckOptions | undefined,
): Required<PublishEpochPhases> {
  const resolved = {
    uploadLeaves: phases?.uploadLeaves ?? true,
    uploadArtifacts: phases?.uploadArtifacts ?? true,
    indexCheck: phases?.indexCheck ?? true,
    anchor: phases?.anchor ?? true,
  };
  if (leafIndexCheck === undefined) {
    resolved.indexCheck = false;
  }
  return resolved;
}

function formatIndexCheckFailure(
  failed: Array<{ leafKey: string; error: string }>,
  totalLeaves: number,
): string {
  const shownKeys = failed.slice(0, 10).map((entry) => entry.leafKey);
  const more = failed.length > shownKeys.length ? `, +${String(failed.length - shownKeys.length)} more` : '';
  return (
    `Index-check failed for ${String(failed.length)} of ${String(totalLeaves)} leaves: ` +
    `${shownKeys.join(', ')}${more}. First error: ${failed[0].error} ` +
    `Anchor blocked; re-run with --retry-failed to re-upload only the failed leaves.`
  );
}

interface ArtifactContext {
  gatewayUrl: string;
  graphqlUrl: string;
  fetchImpl?: typeof fetch;
}

async function resolveOrUploadJsonl(
  deps: PublishEpochDeps,
  epochNumber: number,
  checkpoint: PublishCheckpoint,
  checkpointPath: string,
  phases: Required<PublishEpochPhases>,
  artifactCtx: ArtifactContext | undefined,
): Promise<{ uri: string; checkpoint: PublishCheckpoint }> {
  let current = checkpoint;
  let uri = current.jsonlUri;
  if (uri === undefined && artifactCtx !== undefined) {
    uri =
      (await resolveUploadedArtifactUri({
        ...artifactCtx,
        publisher: current.publisher,
        epochNumber,
        artifactType: 'jsonl',
        expectedJsonlSha256: deps.epoch.jsonlSha256,
      })) ?? undefined;
  }

  if (uri === undefined) {
    deps.onProgress?.({ phase: 'jsonl', completed: 0, total: 1 });
    const upload = await deps.uploader.upload(gzipSync(utf8Bytes(deps.epoch.jsonl)), [
      appTag(),
      epochTag(epochNumber),
      { name: 'Type', value: 'jsonl' },
    ]);
    uri = upload.uri;
    deps.onProgress?.({ phase: 'jsonl', completed: 1, total: 1 });
  }

  current = updateCheckpointUris(current, { jsonlUri: uri });
  saveCheckpoint(checkpointPath, current);
  return { uri, checkpoint: current };
}

async function resolveOrUploadManifest(
  deps: PublishEpochDeps,
  epochNumber: number,
  parentRootContentId: string | null,
  jsonlUri: string,
  signed: ReturnType<typeof signManifest>,
  hash: string,
  checkpoint: PublishCheckpoint,
  checkpointPath: string,
  phases: Required<PublishEpochPhases>,
  artifactCtx: ArtifactContext | undefined,
): Promise<{ uri: string; checkpoint: PublishCheckpoint; signed: ReturnType<typeof signManifest> }> {
  let current = checkpoint;
  let uri = current.manifestUri;
  if (uri === undefined && artifactCtx !== undefined) {
    uri =
      (await resolveUploadedArtifactUri({
        ...artifactCtx,
        publisher: current.publisher,
        epochNumber,
        artifactType: 'manifest',
        expectedManifestHash: hash,
      })) ?? undefined;
  }

  if (uri === undefined) {
    deps.onProgress?.({ phase: 'manifest', completed: 0, total: 1 });
    const upload = await deps.uploader.upload(utf8Bytes(JSON.stringify(signed)), [
      appTag(),
      epochTag(epochNumber),
      { name: 'Type', value: 'manifest' },
    ]);
    uri = upload.uri;
    deps.onProgress?.({ phase: 'manifest', completed: 1, total: 1 });
  }

  current = updateCheckpointUris(current, { manifestUri: uri });
  saveCheckpoint(checkpointPath, current);
  return { uri, checkpoint: current, signed };
}

/** Publish sequence: upload leaves + JSONL + manifest, then anchor on-chain. */
export async function publishEpoch(deps: PublishEpochDeps): Promise<PublishEpochReport> {
  const compiler = deps.compiler ?? DEFAULT_COMPILER;
  const publisher = toChecksumAddress(addressFromPrivateKey(deps.signerKeyHex));
  const publisherAddress = publisher as `0x${string}`;
  const phases = resolvePhases(deps.phases, deps.leafIndexCheck);
  const checkpointPath = deps.checkpointPath ?? '.vincent-publish-checkpoint.json';

  const resolved = await resolveEpochParent(deps.chainPublisher, publisherAddress);

  if (deps.requireGenesis === true && resolved.epochNumber !== 1) {
    await assertGenesisPublisherAvailable(deps.chainPublisher, publisher);
  }

  if (deps.preflight !== undefined) {
    await preflightEpochPublish({
      privateKeyHex: deps.signerKeyHex as `0x${string}`,
      publisher,
      epochCountReader: deps.chainPublisher,
      readLatestEpoch: deps.chainPublisher.readLatestEpoch.bind(deps.chainPublisher),
      preflight: {
        ...deps.preflight,
        requireGenesis: deps.requireGenesis,
        targetEpochNumber: resolved.epochNumber,
      },
    });
  }

  const { epochNumber, parentRootBytes32, parentRootContentId } = resolved;
  const fingerprint = {
    publisher,
    epochNumber,
    merkleRoot: deps.epoch.merkleRoot,
    jsonlSha256: deps.epoch.jsonlSha256,
  };

  let checkpoint = loadOrCreateCheckpoint(checkpointPath, fingerprint);
  const totalLeaves = deps.epoch.leaves.size;
  const needsLeafUriBackfill = needsLeafUriBackfillHint(checkpoint);
  deps.onCheckpointLoaded?.({
    checkpoint,
    totalLeaves,
    uploadedLeaves: checkpoint.uploadedLeafKeys.length,
    indexVerifiedLeaves: checkpoint.indexVerifiedLeafKeys.length,
    failedLeaves: checkpoint.failedLeafKeys.length,
    needsLeafUriBackfill,
  });
  if (needsLeafUriBackfill) {
    deps.onHint?.(formatLeafUriBackfillHint(checkpoint));
  }

  const artifactCtx: ArtifactContext | undefined =
    deps.leafIndexCheck === undefined
      ? undefined
      : {
          gatewayUrl: deps.leafIndexCheck.gatewayUrl,
          graphqlUrl: deps.leafIndexCheck.graphqlUrl,
          fetchImpl: deps.leafIndexCheck.fetchImpl,
        };

  if (phases.indexCheck && deps.leafIndexCheck === undefined) {
    throw new Error('leafIndexCheck gateway/graphql URLs are required for index-check');
  }

  if (phases.uploadLeaves) {
    const concurrency = deps.uploadConcurrency ?? DEFAULT_FULL_UPLOAD_CONCURRENCY;
    const result = await uploadEpochLeaves({
      epoch: deps.epoch,
      epochNumber,
      uploader: deps.uploader,
      checkpoint,
      checkpointPath,
      concurrency,
      onlyLeafKeys:
        deps.uploadScope === 'failed-only' ? [...checkpoint.failedLeafKeys] : undefined,
      onProgress: (progress) => {
        deps.onProgress?.({
          phase: 'leaves',
          completed: progress.completed,
          total: progress.total,
          uploaded: progress.uploaded,
          skipped: progress.skipped,
          checkpointCount: progress.checkpointCount,
        });
      },
    });
    checkpoint = result.checkpoint;
  }

  let jsonlUri = checkpoint.jsonlUri;
  let manifestUri = checkpoint.manifestUri;
  let signed = signManifest(
    buildManifest({
      epoch: epochNumber,
      parentRoot: parentRootContentId,
      merkleRoot: deps.epoch.merkleRoot,
      jsonlSha256: deps.epoch.jsonlSha256,
      uris: [jsonlUri ?? 'ar://pending'],
      compiler,
      reviewPolicy: {
        minAccepts: DEFAULT_GENESIS_REVIEW_POLICY.minAccepts,
        reviewers: [publisher],
      },
    }),
    deps.signerKeyHex,
  );
  let hash = manifestHash(signed);

  if (phases.uploadArtifacts || phases.indexCheck || phases.anchor) {
    const jsonlResult = await resolveOrUploadJsonl(
      deps,
      epochNumber,
      checkpoint,
      checkpointPath,
      phases,
      artifactCtx,
    );
    jsonlUri = jsonlResult.uri;
    checkpoint = jsonlResult.checkpoint;

    const unsigned = buildManifest({
      epoch: epochNumber,
      parentRoot: parentRootContentId,
      merkleRoot: deps.epoch.merkleRoot,
      jsonlSha256: deps.epoch.jsonlSha256,
      uris: [jsonlUri],
      compiler,
      reviewPolicy: {
        minAccepts: DEFAULT_GENESIS_REVIEW_POLICY.minAccepts,
        reviewers: [publisher],
      },
    });
    signed = signManifest(unsigned, deps.signerKeyHex);
    hash = manifestHash(signed);

    const manifestResult = await resolveOrUploadManifest(
      deps,
      epochNumber,
      parentRootContentId,
      jsonlUri,
      signed,
      hash,
      checkpoint,
      checkpointPath,
      phases,
      artifactCtx,
    );
    manifestUri = manifestResult.uri;
    checkpoint = manifestResult.checkpoint;
  }

  if (phases.indexCheck && deps.leafIndexCheck !== undefined) {
    const result = await verifyUploadedLeaves({
      epoch: deps.epoch,
      publisher,
      epochNumber,
      gatewayUrl: deps.leafIndexCheck.gatewayUrl,
      graphqlUrl: deps.leafIndexCheck.graphqlUrl,
      fetchImpl: deps.leafIndexCheck.fetchImpl,
      timeoutMs: deps.leafIndexCheck.timeoutMs,
      pollIntervalMs: deps.leafIndexCheck.pollIntervalMs,
      sleep: deps.leafIndexCheck.sleep,
      delayMs: deps.leafIndexCheck.delayMs,
      concurrency: deps.leafIndexCheck.concurrency,
      reuploadOnFailure: deps.leafIndexCheck.reuploadOnFailure,
      maxReuploadAttempts: deps.leafIndexCheck.maxReuploadAttempts,
      maxReuploadLeaves: deps.leafIndexCheck.maxReuploadLeaves,
      postReuploadDelayMs: deps.leafIndexCheck.postReuploadDelayMs,
      gatewayFallback: deps.leafIndexCheck.gatewayFallback,
      skipGraphqlPoll: deps.leafIndexCheck.skipGraphqlPoll,
      onReupload: deps.leafIndexCheck.onReupload,
      onDelay: deps.leafIndexCheck.onDelay,
      onLeafFailed: deps.leafIndexCheck.onLeafFailed,
      uploader: deps.uploader,
      checkpoint,
      checkpointPath,
      onLeafVerified: (completed, total) => {
        deps.onProgress?.({ phase: 'index-check', completed, total });
      },
    });
    checkpoint = result.checkpoint ?? checkpoint;

    if (result.failed.length > 0) {
      throw new Error(formatIndexCheckFailure(result.failed, deps.epoch.leaves.size));
    }

    if (
      deps.leafUriSidecar?.publish === true &&
      Object.keys(checkpoint.leafUris).length > 0
    ) {
      try {
        const published = await publishLeafUriSidecarFromCheckpoint({
          uploader: deps.uploader,
          checkpoint,
        });
        checkpoint = setLeafUriSidecarUri(checkpoint, published.uri);
        saveCheckpoint(checkpointPath, checkpoint);
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        deps.leafUriSidecar.onWarning?.(
          `Leaf uri sidecar upload failed (continuing): ${message}`,
        );
      }
    }
  }

  if (!phases.anchor) {
    return {
      publisher,
      jsonlUri: jsonlUri ?? 'ar://pending',
      manifestUri: manifestUri ?? 'ar://pending',
      manifestHash: hash,
      txHash: `0x${'0'.repeat(64)}`,
      leafCount: deps.epoch.leaves.size,
      manifest: signed,
    };
  }

  if (jsonlUri === undefined || manifestUri === undefined) {
    throw new Error('JSONL and manifest URIs are required before index-check or anchor');
  }

  deps.onProgress?.({ phase: 'anchor', completed: 0, total: 1 });
  const txHash = await deps.chainPublisher.publishEpoch({
    merkleRoot: sha256ContentIdToBytes32(deps.epoch.merkleRoot),
    jsonlSha256: sha256ContentIdToBytes32(deps.epoch.jsonlSha256),
    manifestHash: sha256ContentIdToBytes32(hash),
    parentRoot: parentRootBytes32,
    manifestUri,
  });
  deps.onProgress?.({ phase: 'anchor', completed: 1, total: 1 });

  return {
    publisher,
    jsonlUri,
    manifestUri,
    manifestHash: hash,
    txHash,
    leafCount: deps.epoch.leaves.size,
    manifest: signed,
  };
}
