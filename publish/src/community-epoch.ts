import { randomBytes } from 'node:crypto';

import { compile, type EpochBuild } from '@kargain/vincent-compiler';
import {
  addressFromPrivateKey,
  claimHash,
  parseClaim,
  toChecksumAddress,
  type Claim,
  type ReviewPolicy,
} from '@kargain/vincent/protocol';

import type { ChainPublisher, Uploader } from './adapters/types.js';
import { computeRemainingUploadByteSizes } from './estimate-epoch-upload-cost.js';
import { parseReviewArchive, type ReviewArchiveSummary } from './parse-review-archive.js';
import {
  loadOrCreateCheckpoint,
  saveCheckpoint,
  setPublishNotBefore,
  setReviewArchiveUri,
  uploadedLeafKeySet,
} from './publish-checkpoint.js';
import {
  publishEpoch,
  type CheckpointLoadSummary,
  type LeafIndexCheckOptions,
  type LeafUriSidecarOptions,
  type PublishEpochPhases,
  type PublishEpochProgress,
  type PublishEpochReport,
} from './publish-epoch.js';
import {
  preflightEpochPublish,
  type EpochPreflightOptions,
  type EpochUploadBudgetPreflight,
} from './preflight-genesis-publish.js';
import { resolveEpochParent, type EpochChainReader } from './resolve-epoch-parent.js';

/** ANS-104 `Kind` tag for the non-normative attestation-archive sidecar. */
export const REVIEW_ARCHIVE_KIND = 'review-archive';

export const DEFAULT_COMMUNITY_CHECKPOINT_PATH = '.vincent-community-checkpoint.json';

const MS_PER_DAY = 86_400_000;

export interface AssembleCommunityEpochInput {
  /** Verified base-epoch claims (see fetchBaseEpoch); never a local build artifact. */
  baseClaims: Claim[];
  /** Raw contents of accepted-community-claims.jsonl (JCS lines). */
  communityClaimsJsonl: string;
  /** Validated attestation archive (see parseReviewArchive). */
  archive: ReviewArchiveSummary;
}

export interface AssembledCommunityEpoch {
  epoch: EpochBuild;
  /** `minAccepts: 1` + archive endorsers; effective acceptance is a client-profile matter. */
  reviewPolicy: ReviewPolicy;
  baseClaimCount: number;
  communityClaimCount: number;
  /** Claim count after claimHash dedupe (full snapshot). */
  mergedClaimCount: number;
}

/** Parse accepted-community-claims.jsonl into validated claims (fail-closed per line). */
export function parseCommunityClaims(jsonl: string): Claim[] {
  const claims: Claim[] = [];
  const lines = jsonl.split('\n');

  for (let i = 0; i < lines.length; i += 1) {
    const line = lines[i];
    if (line.length === 0) continue;

    let json: unknown;
    try {
      json = JSON.parse(line);
    } catch {
      throw new Error(`Community claims: line ${String(i + 1)} is not valid JSON`);
    }

    const parsed = parseClaim(json);
    if (!parsed.ok) {
      throw new Error(
        `Community claims: line ${String(i + 1)} is not a valid claim: ${parsed.error.message}`,
      );
    }
    claims.push(parsed.value);
  }

  if (claims.length === 0) {
    throw new Error('Community claims: file contains no claims');
  }

  return claims;
}

/**
 * Merge base + community claims into a full-snapshot epoch and compile it.
 *
 * Hard gate: every community claim must carry at least one valid `endorse` in
 * the attestation archive. Determinism: the compiler's canonical sort makes the
 * output byte-reproducible for the same inputs (§7.2).
 */
export function assembleCommunityEpoch(
  input: AssembleCommunityEpochInput,
): AssembledCommunityEpoch {
  const communityClaims = parseCommunityClaims(input.communityClaimsJsonl);

  const merged = new Map<string, Claim>();
  for (const claim of input.baseClaims) {
    merged.set(claimHash(claim), claim);
  }

  for (const claim of communityClaims) {
    const hash = claimHash(claim);
    const endorsers = input.archive.endorsersByClaim.get(hash);
    if (endorsers === undefined || endorsers.length === 0) {
      throw new Error(
        `Community claims: ${hash} has no valid endorse attestation in the archive`,
      );
    }
    merged.set(hash, claim);
  }

  if (input.archive.endorsers.length === 0) {
    throw new Error('Community claims: archive contains no valid endorse attesters');
  }

  const built = compile([...merged.values()], {});
  if (!built.ok) {
    throw new Error(`Community epoch compile failed: ${built.error.message}`);
  }

  return {
    epoch: built.value,
    reviewPolicy: { minAccepts: 1, reviewers: [...input.archive.endorsers] },
    baseClaimCount: input.baseClaims.length,
    communityClaimCount: communityClaims.length,
    mergedClaimCount: merged.size,
  };
}

export interface CommunityJitterOptions {
  /**
   * §4.8 randomized publish delay: on first run, pick a crypto-random target in
   * [now, now + jitterDays] and persist it in the checkpoint. Until the target,
   * every upload/anchor stage refuses to run (re-runs never re-roll the window).
   */
  jitterDays?: number;
  /** Skip the jitter gate (testnet-only). */
  force?: boolean;
  /** Injectable clock for tests. */
  now?: () => Date;
  /** Injectable uniform [0, 1) source for tests. */
  random?: () => number;
}

export interface PublishCommunityEpochDeps {
  baseClaims: Claim[];
  communityClaimsJsonl: string;
  /** Original attestation-archive.json bytes; uploaded as-is, never re-serialized. */
  archiveBytes: Uint8Array;
  signerKeyHex: string;
  uploader: Uploader;
  chainPublisher: ChainPublisher & EpochChainReader;
  compiler?: { name: string; version: string };
  jitter?: CommunityJitterOptions;
  checkpointPath?: string;
  preflight?: EpochPreflightOptions;
  /**
   * Irys upload-budget preflight hooks; epoch/epochNumber/parentRoot/byteSizes
   * are filled in from the assembled build and the checkpoint (remaining bytes
   * only, including the archive sidecar when not yet uploaded).
   */
  uploadBudget?: Omit<
    EpochUploadBudgetPreflight,
    'epoch' | 'epochNumber' | 'parentRootContentId' | 'byteSizes'
  >;
  leafIndexCheck?: LeafIndexCheckOptions;
  phases?: PublishEpochPhases;
  uploadScope?: 'all' | 'failed-only';
  uploadConcurrency?: number;
  onProgress?: (progress: PublishEpochProgress) => void;
  onCheckpointLoaded?: (summary: CheckpointLoadSummary) => void;
  onHint?: (message: string) => void;
  leafUriSidecar?: LeafUriSidecarOptions;
}

export type PublishCommunityEpochResult =
  | {
      status: 'window-pending';
      /** ISO timestamp when the publish window opens; re-run the same command after it. */
      publishNotBefore: string;
      epochNumber: number;
      assembled: AssembledCommunityEpoch;
    }
  | {
      status: 'published';
      report: PublishEpochReport;
      /** ar:// URI of the Kind=review-archive sidecar (absent on anchor-only resume paths). */
      reviewArchiveUri?: string;
      assembled: AssembledCommunityEpoch;
    };

function defaultRandom(): number {
  return randomBytes(6).readUIntBE(0, 6) / 2 ** 48;
}

function decodeArchive(bytes: Uint8Array): ReviewArchiveSummary {
  let json: unknown;
  try {
    json = JSON.parse(new TextDecoder().decode(bytes));
  } catch {
    throw new Error('Invalid review archive: file is not valid JSON');
  }
  return parseReviewArchive(json);
}

/**
 * Publish a community epoch on the caller's own chain: full snapshot of a
 * verified base epoch plus endorsed community claims, attestation archive as a
 * non-normative ANS-104 sidecar, own-chain lineage (genesis `parent: null` or
 * prior own-chain merkleRoot), jitter-gated per §4.8.
 */
export async function publishCommunityEpoch(
  deps: PublishCommunityEpochDeps,
): Promise<PublishCommunityEpochResult> {
  const archive = decodeArchive(deps.archiveBytes);
  const assembled = assembleCommunityEpoch({
    baseClaims: deps.baseClaims,
    communityClaimsJsonl: deps.communityClaimsJsonl,
    archive,
  });

  const publisher = toChecksumAddress(addressFromPrivateKey(deps.signerKeyHex));
  const checkpointPath = deps.checkpointPath ?? DEFAULT_COMMUNITY_CHECKPOINT_PATH;
  const resolved = await resolveEpochParent(deps.chainPublisher, publisher as `0x${string}`);

  let checkpoint = loadOrCreateCheckpoint(checkpointPath, {
    publisher,
    epochNumber: resolved.epochNumber,
    merkleRoot: assembled.epoch.merkleRoot,
    jsonlSha256: assembled.epoch.jsonlSha256,
  });

  const now = deps.jitter?.now?.() ?? new Date();
  let publishNotBefore = checkpoint.publishNotBefore;

  if (publishNotBefore === undefined && deps.jitter?.jitterDays !== undefined) {
    const days = deps.jitter.jitterDays;
    if (!Number.isFinite(days) || days < 0) {
      throw new Error('jitterDays must be a non-negative number');
    }
    const random = deps.jitter.random ?? defaultRandom;
    const offsetMs = Math.floor(random() * days * MS_PER_DAY);
    publishNotBefore = new Date(now.getTime() + offsetMs).toISOString();
    checkpoint = setPublishNotBefore(checkpoint, publishNotBefore);
    saveCheckpoint(checkpointPath, checkpoint);
  }

  if (
    publishNotBefore !== undefined &&
    deps.jitter?.force !== true &&
    now.getTime() < Date.parse(publishNotBefore)
  ) {
    return {
      status: 'window-pending',
      publishNotBefore,
      epochNumber: resolved.epochNumber,
      assembled,
    };
  }

  if (deps.preflight !== undefined) {
    const uploadBudget: EpochUploadBudgetPreflight | undefined =
      deps.uploadBudget === undefined
        ? undefined
        : {
            ...deps.uploadBudget,
            epoch: assembled.epoch,
            epochNumber: resolved.epochNumber,
            parentRootContentId: resolved.parentRootContentId,
            byteSizes: [
              ...computeRemainingUploadByteSizes({
                epoch: assembled.epoch,
                epochNumber: resolved.epochNumber,
                parentRoot: resolved.parentRootContentId,
                completedLeafKeys: uploadedLeafKeySet(checkpoint),
                includeJsonl: checkpoint.jsonlUri === undefined,
                includeManifest: checkpoint.manifestUri === undefined,
              }),
              ...(checkpoint.reviewArchiveUri === undefined ? [deps.archiveBytes.length] : []),
            ],
          };

    await preflightEpochPublish({
      privateKeyHex: deps.signerKeyHex as `0x${string}`,
      publisher,
      epochCountReader: deps.chainPublisher,
      readLatestEpoch: deps.chainPublisher.readLatestEpoch.bind(deps.chainPublisher),
      preflight: {
        ...deps.preflight,
        targetEpochNumber: resolved.epochNumber,
        uploadBudget,
      },
    });
  }

  let reviewArchiveUri = checkpoint.reviewArchiveUri;
  const uploadArtifacts = deps.phases?.uploadArtifacts ?? true;
  if (reviewArchiveUri === undefined && uploadArtifacts) {
    const upload = await deps.uploader.upload(deps.archiveBytes, [
      { name: 'App', value: 'vincent' },
      { name: 'Epoch', value: String(resolved.epochNumber) },
      { name: 'Kind', value: REVIEW_ARCHIVE_KIND },
    ]);
    reviewArchiveUri = upload.uri;
    checkpoint = setReviewArchiveUri(checkpoint, reviewArchiveUri);
    saveCheckpoint(checkpointPath, checkpoint);
  }

  const report = await publishEpoch({
    epoch: assembled.epoch,
    signerKeyHex: deps.signerKeyHex,
    uploader: deps.uploader,
    chainPublisher: deps.chainPublisher,
    compiler: deps.compiler,
    reviewPolicy: assembled.reviewPolicy,
    leafIndexCheck: deps.leafIndexCheck,
    phases: deps.phases,
    uploadScope: deps.uploadScope,
    uploadConcurrency: deps.uploadConcurrency,
    checkpointPath,
    onProgress: deps.onProgress,
    onCheckpointLoaded: deps.onCheckpointLoaded,
    onHint: deps.onHint,
    leafUriSidecar: deps.leafUriSidecar,
  });

  return { status: 'published', report, reviewArchiveUri, assembled };
}
