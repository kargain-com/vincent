import type { EpochBuild } from '@kargain/vincent-compiler';

import type { UploadTag, Uploader } from './adapters/types.js';
import {
  markLeafUploaded,
  saveCheckpoint,
  uploadedLeafKeySet,
  type PublishCheckpoint,
} from './publish-checkpoint.js';
import { runWithConcurrency } from './run-with-concurrency.js';

export interface UploadEpochLeavesProgress {
  completed: number;
  total: number;
  uploaded: number;
  skipped: number;
  checkpointCount: number;
}

export interface UploadEpochLeavesOptions {
  epoch: EpochBuild;
  epochNumber: number;
  uploader: Uploader;
  checkpoint: PublishCheckpoint;
  checkpointPath: string;
  concurrency: number;
  /**
   * When set, upload exactly these leaves (even if already marked uploaded);
   * used by --retry-failed to re-push previously failed leaves.
   */
  onlyLeafKeys?: readonly string[];
  onProgress?: (progress: UploadEpochLeavesProgress) => void;
}

export interface UploadEpochLeavesResult {
  uploaded: number;
  skipped: number;
  checkpoint: PublishCheckpoint;
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

/** Upload pending leaves in parallel; persist checkpoint after each success. */
export async function uploadEpochLeaves(
  options: UploadEpochLeavesOptions,
): Promise<UploadEpochLeavesResult> {
  const sortedLeaves = [...options.epoch.leaves.entries()].sort(([a], [b]) => a.localeCompare(b));
  const total = sortedLeaves.length;
  const scope = options.onlyLeafKeys === undefined ? undefined : new Set(options.onlyLeafKeys);
  const done = uploadedLeafKeySet(options.checkpoint);
  const pending =
    scope === undefined
      ? sortedLeaves.filter(([leafKey]) => !done.has(leafKey))
      : sortedLeaves.filter(([leafKey]) => scope.has(leafKey));

  let checkpoint = options.checkpoint;
  let uploaded = 0;
  const skipped = total - pending.length;
  let completed = skipped;

  const emit = (): void => {
    options.onProgress?.({
      completed,
      total,
      uploaded,
      skipped,
      checkpointCount: checkpoint.uploadedLeafKeys.length,
    });
  };

  emit();
  if (pending.length === 0) {
    return { uploaded, skipped, checkpoint };
  }

  let checkpointLock: Promise<void> = Promise.resolve();
  let counterLock: Promise<void> = Promise.resolve();

  const persistLeaf = async (leafKey: string, uri: string): Promise<void> => {
    checkpointLock = checkpointLock.then(() => {
      checkpoint = markLeafUploaded(checkpoint, leafKey, uri);
      saveCheckpoint(options.checkpointPath, checkpoint);
    });
    await checkpointLock;
  };

  const bumpUploaded = async (): Promise<void> => {
    counterLock = counterLock.then(() => {
      uploaded += 1;
      completed += 1;
      emit();
    });
    await counterLock;
  };

  await runWithConcurrency(pending, options.concurrency, async ([leafKey, entry]) => {
    const result = await options.uploader.upload(
      utf8Bytes(JSON.stringify({ leaf: entry.leaf, proof: entry.proof })),
      [appTag(), epochTag(options.epochNumber), { name: 'LeafKey', value: leafKey }],
    );
    await persistLeaf(leafKey, result.uri);
    await bumpUploaded();
  });

  return { uploaded, skipped, checkpoint };
}
