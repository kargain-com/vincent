import type { EpochBuild } from '@kargain/vincent-compiler';
import { createArweaveGetLeaf } from '@kargain/vincent/arweave';
import { verifyLeaf } from '@kargain/vincent/decoder';

import type { UploadResult, UploadTag, Uploader } from './adapters/types.js';
import { verifyLeafFromGateway } from './fetch-leaf-from-gateway.js';
import {
  indexVerifiedLeafKeySet,
  markLeafFailed,
  markLeafIndexVerified,
  saveCheckpoint,
  setLeafUri,
  type PublishCheckpoint,
} from './publish-checkpoint.js';
import { leafTxIdToUri, resolveLeafTxId } from './resolve-leaf-tx-id.js';
import { runWithConcurrency } from './run-with-concurrency.js';

export interface VerifyUploadedLeavesOptions {
  epoch: EpochBuild;
  publisher: string;
  epochNumber: number;
  gatewayUrl: string;
  graphqlUrl: string;
  fetchImpl?: typeof fetch;
  timeoutMs?: number;
  pollIntervalMs?: number;
  sleep?: (ms: number) => Promise<void>;
  delayMs?: number;
  concurrency?: number;
  reuploadOnFailure?: boolean;
  maxReuploadAttempts?: number;
  postReuploadDelayMs?: number;
  /** Verify by tx id directly from the gateway when GraphQL lags (default false). */
  gatewayFallback?: boolean;
  /**
   * When true, skip the long GraphQL poll before re-upload. Uses checkpoint leafUri,
   * a single GraphQL tx-id lookup, then re-upload + gateway verify (--anchor-only).
   */
  skipGraphqlPoll?: boolean;
  uploader?: Uploader;
  checkpoint?: PublishCheckpoint;
  checkpointPath?: string;
  onLeafVerified?: (completed: number, total: number) => void;
  onLeafFailed?: (leafKey: string, error: string) => void;
  onReupload?: (leafKey: string, attempt: number, maxAttempts: number) => void;
  onDelay?: (delayMs: number) => void;
}

export interface VerifyUploadedLeavesResult {
  verified: number;
  failed: Array<{ leafKey: string; error: string }>;
  checkpoint?: PublishCheckpoint;
}

const DEFAULT_TIMEOUT_MS = 30_000;
const DEFAULT_POLL_INTERVAL_MS = 1_000;
const DEFAULT_INDEX_CONCURRENCY = 20;
const DEFAULT_REUPLOAD_ATTEMPTS = 3;

function defaultSleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
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

function isMissingLeafError(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error);
  return message.includes('missing leaf for LeafKey');
}

function isIndexTimeoutError(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error);
  return (
    message.includes('not indexed via GraphQL') ||
    message.includes('not retrievable via gateway')
  );
}

async function waitForLeaf(
  getLeaf: ReturnType<typeof createArweaveGetLeaf>,
  leafKey: string,
  merkleRoot: string,
  deadline: number,
  pollIntervalMs: number,
  sleep: (ms: number) => Promise<void>,
): Promise<void> {
  while (Date.now() < deadline) {
    try {
      const fetched = await getLeaf(leafKey);
      const verified = verifyLeaf(fetched.leaf, fetched.proof, merkleRoot);
      if (verified.ok) return;
      throw new Error(`Merkle proof invalid for LeafKey ${leafKey}: ${verified.reason}`);
    } catch (error) {
      if (!isMissingLeafError(error)) {
        throw error instanceof Error ? error : new Error(String(error));
      }
    }
    await sleep(pollIntervalMs);
  }

  throw new Error(
    `LeafKey ${leafKey} not indexed via GraphQL before anchor deadline; ` +
      'check IRYS_GRAPHQL_URL (expected https://uploader.irys.xyz/graphql)',
  );
}

async function reuploadLeaf(
  options: VerifyUploadedLeavesOptions,
  leafKey: string,
): Promise<UploadResult> {
  if (options.uploader === undefined) {
    throw new Error(`LeafKey ${leafKey} missing on Irys and no uploader provided for re-upload`);
  }
  const entry = options.epoch.leaves.get(leafKey);
  if (entry === undefined) {
    throw new Error(`LeafKey ${leafKey} missing from compiled epoch`);
  }
  return options.uploader.upload(utf8Bytes(JSON.stringify({ leaf: entry.leaf, proof: entry.proof })), [
    appTag(),
    epochTag(options.epochNumber),
    { name: 'LeafKey', value: leafKey },
  ]);
}

interface CheckpointState {
  current?: PublishCheckpoint;
  chain: Promise<void>;
}

async function updateCheckpoint(
  options: VerifyUploadedLeavesOptions,
  state: CheckpointState,
  update: (checkpoint: PublishCheckpoint) => PublishCheckpoint,
): Promise<void> {
  if (state.current === undefined || options.checkpointPath === undefined) return;
  state.chain = state.chain.then(() => {
    state.current = update(state.current!);
    saveCheckpoint(options.checkpointPath!, state.current);
  });
  await state.chain;
}

async function verifyViaGateway(
  options: VerifyUploadedLeavesOptions,
  uri: string,
): Promise<boolean> {
  if (options.gatewayFallback !== true) return false;
  return verifyLeafFromGateway({
    gatewayUrl: options.gatewayUrl,
    txIdOrUri: uri,
    merkleRoot: options.epoch.merkleRoot,
    fetchImpl: options.fetchImpl,
  });
}

async function persistLeafUri(
  options: VerifyUploadedLeavesOptions,
  state: CheckpointState,
  leafKey: string,
  uri: string,
): Promise<void> {
  await updateCheckpoint(options, state, (checkpoint) => setLeafUri(checkpoint, leafKey, uri));
}

async function tryGatewayUri(
  options: VerifyUploadedLeavesOptions,
  state: CheckpointState,
  leafKey: string,
  uri: string,
  markVerified: () => Promise<void>,
): Promise<boolean> {
  if (await verifyViaGateway(options, uri)) {
    await markVerified();
    return true;
  }
  return false;
}

async function resolveAndVerifyFromGraphql(
  options: VerifyUploadedLeavesOptions,
  state: CheckpointState,
  leafKey: string,
  markVerified: () => Promise<void>,
): Promise<boolean> {
  const txId = await resolveLeafTxId({
    graphqlUrl: options.graphqlUrl,
    publisher: options.publisher,
    epoch: options.epochNumber,
    leafKey,
    fetchImpl: options.fetchImpl,
  });
  if (txId === null) return false;

  const uri = leafTxIdToUri(txId);
  await persistLeafUri(options, state, leafKey, uri);
  return tryGatewayUri(options, state, leafKey, uri, markVerified);
}

async function verifyLeafGatewayFirst(
  options: VerifyUploadedLeavesOptions,
  getLeaf: ReturnType<typeof createArweaveGetLeaf>,
  leafKey: string,
  state: CheckpointState,
): Promise<void> {
  const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const pollIntervalMs = options.pollIntervalMs ?? DEFAULT_POLL_INTERVAL_MS;
  const sleep = options.sleep ?? defaultSleep;
  const maxReuploads = options.reuploadOnFailure === true
    ? (options.maxReuploadAttempts ?? DEFAULT_REUPLOAD_ATTEMPTS)
    : 0;
  const postReuploadDelayMs = options.postReuploadDelayMs ?? 0;

  const markVerified = async (): Promise<void> => {
    await updateCheckpoint(options, state, (checkpoint) =>
      markLeafIndexVerified(checkpoint, leafKey),
    );
  };

  const knownUri = state.current?.leafUris[leafKey];
  if (knownUri !== undefined && (await tryGatewayUri(options, state, leafKey, knownUri, markVerified))) {
    return;
  }

  if (await resolveAndVerifyFromGraphql(options, state, leafKey, markVerified)) {
    return;
  }

  let reuploadsUsed = 0;
  while (reuploadsUsed < maxReuploads) {
    if (options.uploader === undefined) break;

    reuploadsUsed += 1;
    options.onReupload?.(leafKey, reuploadsUsed, maxReuploads);
    const upload = await reuploadLeaf(options, leafKey);
    await persistLeafUri(options, state, leafKey, upload.uri);

    if (await tryGatewayUri(options, state, leafKey, upload.uri, markVerified)) {
      return;
    }

    if (await resolveAndVerifyFromGraphql(options, state, leafKey, markVerified)) {
      return;
    }

    if (postReuploadDelayMs > 0) {
      await sleep(postReuploadDelayMs);
    }
  }

  // Last resort: short GraphQL poll (e.g. bundler indexed but gateway lagged).
  try {
    await waitForLeaf(
      getLeaf,
      leafKey,
      options.epoch.merkleRoot,
      Date.now() + timeoutMs,
      pollIntervalMs,
      sleep,
    );
    await markVerified();
    return;
  } catch {
    // fall through
  }

  throw new Error(
    `LeafKey ${leafKey} not retrievable via gateway after ${String(reuploadsUsed)} re-upload(s); ` +
      're-run with --retry-failed',
  );
}

async function verifyLeafWithRecovery(
  options: VerifyUploadedLeavesOptions,
  getLeaf: ReturnType<typeof createArweaveGetLeaf>,
  leafKey: string,
  state: CheckpointState,
): Promise<void> {
  if (options.skipGraphqlPoll === true) {
    return verifyLeafGatewayFirst(options, getLeaf, leafKey, state);
  }

  const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const pollIntervalMs = options.pollIntervalMs ?? DEFAULT_POLL_INTERVAL_MS;
  const sleep = options.sleep ?? defaultSleep;
  const maxReuploads = options.reuploadOnFailure === true
    ? (options.maxReuploadAttempts ?? DEFAULT_REUPLOAD_ATTEMPTS)
    : 0;
  const postReuploadDelayMs = options.postReuploadDelayMs ?? 0;
  const gatewayFallback = options.gatewayFallback === true;

  const markVerified = async (): Promise<void> => {
    await updateCheckpoint(options, state, (checkpoint) =>
      markLeafIndexVerified(checkpoint, leafKey),
    );
  };

  const knownUri = state.current?.leafUris[leafKey];
  if (gatewayFallback && knownUri !== undefined) {
    if (await tryGatewayUri(options, state, leafKey, knownUri, markVerified)) {
      return;
    }
  }

  let reuploadsUsed = 0;
  while (true) {
    try {
      await waitForLeaf(
        getLeaf,
        leafKey,
        options.epoch.merkleRoot,
        Date.now() + timeoutMs,
        pollIntervalMs,
        sleep,
      );
      await markVerified();
      return;
    } catch (error) {
      const canReupload =
        options.reuploadOnFailure === true &&
        options.uploader !== undefined &&
        reuploadsUsed < maxReuploads &&
        isIndexTimeoutError(error);
      if (!canReupload) throw error;

      reuploadsUsed += 1;
      options.onReupload?.(leafKey, reuploadsUsed, maxReuploads);
      const upload = await reuploadLeaf(options, leafKey);
      await persistLeafUri(options, state, leafKey, upload.uri);

      if (gatewayFallback && (await tryGatewayUri(options, state, leafKey, upload.uri, markVerified))) {
        return;
      }

      if (postReuploadDelayMs > 0) {
        await sleep(postReuploadDelayMs);
      }
    }
  }
}

/**
 * Verify all leaves against the GraphQL index (with optional gateway fallback).
 * Never fail-fast: failures are collected per leaf and returned so the caller
 * can block the anchor and offer a targeted --retry-failed run.
 */
export async function verifyUploadedLeaves(
  options: VerifyUploadedLeavesOptions,
): Promise<VerifyUploadedLeavesResult> {
  const sleep = options.sleep ?? defaultSleep;
  const delayMs = options.delayMs ?? 0;
  if (delayMs > 0) {
    options.onDelay?.(delayMs);
    await sleep(delayMs);
  }

  const getLeaf = createArweaveGetLeaf({
    gatewayUrl: options.gatewayUrl,
    graphqlUrl: options.graphqlUrl,
    publisher: options.publisher.toLowerCase(),
    epoch: options.epochNumber,
    fetchImpl: options.fetchImpl,
  });

  const allLeafKeys = [...options.epoch.leaves.keys()].sort((a, b) => a.localeCompare(b));
  const alreadyVerified =
    options.checkpoint !== undefined
      ? indexVerifiedLeafKeySet(options.checkpoint)
      : new Set<string>();
  const pendingLeafKeys = allLeafKeys.filter((leafKey) => !alreadyVerified.has(leafKey));
  const concurrency = options.concurrency ?? DEFAULT_INDEX_CONCURRENCY;
  let completed = allLeafKeys.length - pendingLeafKeys.length;
  options.onLeafVerified?.(completed, allLeafKeys.length);

  let progressLock: Promise<void> = Promise.resolve();
  const state: CheckpointState = { current: options.checkpoint, chain: Promise.resolve() };
  const failed: VerifyUploadedLeavesResult['failed'] = [];

  await runWithConcurrency(pendingLeafKeys, concurrency, async (leafKey) => {
    try {
      await verifyLeafWithRecovery(options, getLeaf, leafKey, state);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      failed.push({ leafKey, error: message });
      options.onLeafFailed?.(leafKey, message);
      await updateCheckpoint(options, state, (checkpoint) => markLeafFailed(checkpoint, leafKey));
      return;
    }
    progressLock = progressLock.then(() => {
      completed += 1;
      options.onLeafVerified?.(completed, allLeafKeys.length);
    });
    await progressLock;
  });

  return {
    verified: completed,
    failed,
    checkpoint: state.current,
  };
}
