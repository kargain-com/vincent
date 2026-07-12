import type { EpochBuild } from '@kargain/vincent-compiler';
import { addressFromPrivateKey, toChecksumAddress } from '@kargain/vincent/protocol';
import { gzipSync } from 'node:zlib';

import type { ChainPublisher, PublishGenesisReport, UploadTag, Uploader } from './adapters/types.js';
import { sha256ContentIdToBytes32, ZERO_BYTES32 } from './adapters/sha256-bytes32.js';
import type { EpochCountReader } from './assert-genesis-publisher.js';
import { buildManifest } from './build-manifest.js';
import { DEFAULT_GENESIS_REVIEW_POLICY } from './constants.js';
import { preflightGenesisPublish, type GenesisPreflightOptions } from './preflight-genesis-publish.js';
import { manifestHash, signManifest } from './sign-manifest.js';
import {
  verifyUploadedLeaves,
  type VerifyUploadedLeavesOptions,
} from './verify-uploaded-leaves.js';

const DEFAULT_COMPILER = { name: 'vincent-compiler', version: '0.0.1' } as const;

export interface LeafIndexCheckOptions {
  gatewayUrl: string;
  graphqlUrl: string;
  fetchImpl?: typeof fetch;
  timeoutMs?: number;
  pollIntervalMs?: number;
  sleep?: VerifyUploadedLeavesOptions['sleep'];
}

export interface PublishGenesisDeps {
  epoch: EpochBuild;
  signerKeyHex: string;
  uploader: Uploader;
  chainPublisher: ChainPublisher;
  compiler?: { name: string; version: string };
  epochNumber?: number;
  /** When set, run live preflight before any Arweave/Irys uploads. */
  preflight?: GenesisPreflightOptions;
  /** When set, verify GraphQL leaf indexing before on-chain anchor. */
  leafIndexCheck?: LeafIndexCheckOptions;
}

function isEpochCountReader(value: ChainPublisher): value is ChainPublisher & EpochCountReader {
  return 'readEpochCount' in value && typeof value.readEpochCount === 'function';
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

/** Genesis publish sequence: upload leaves + JSONL + manifest, then anchor on-chain. */
export async function publishGenesis(deps: PublishGenesisDeps): Promise<PublishGenesisReport> {
  const epochNumber = deps.epochNumber ?? 1;
  if (epochNumber !== 1) {
    throw new Error('publishGenesis currently supports genesis epoch 1 only');
  }

  const compiler = deps.compiler ?? DEFAULT_COMPILER;
  const publisher = toChecksumAddress(addressFromPrivateKey(deps.signerKeyHex));

  if (deps.preflight !== undefined) {
    if (!isEpochCountReader(deps.chainPublisher)) {
      throw new Error('preflight requires chainPublisher with readEpochCount');
    }
    await preflightGenesisPublish({
      privateKeyHex: deps.signerKeyHex as `0x${string}`,
      publisher,
      epochCountReader: deps.chainPublisher,
      preflight: deps.preflight,
    });
  }

  const sortedLeaves = [...deps.epoch.leaves.entries()].sort(([a], [b]) => a.localeCompare(b));
  for (const [leafKey, entry] of sortedLeaves) {
    await deps.uploader.upload(utf8Bytes(JSON.stringify({ leaf: entry.leaf, proof: entry.proof })), [
      appTag(),
      epochTag(epochNumber),
      { name: 'LeafKey', value: leafKey },
    ]);
  }

  const jsonlUpload = await deps.uploader.upload(gzipSync(utf8Bytes(deps.epoch.jsonl)), [
    appTag(),
    epochTag(epochNumber),
    { name: 'Type', value: 'jsonl' },
  ]);
  const jsonlUri = jsonlUpload.uri;

  const unsigned = buildManifest({
    epoch: epochNumber,
    parentRoot: null,
    merkleRoot: deps.epoch.merkleRoot,
    jsonlSha256: deps.epoch.jsonlSha256,
    uris: [jsonlUri],
    compiler,
    reviewPolicy: {
      minAccepts: DEFAULT_GENESIS_REVIEW_POLICY.minAccepts,
      reviewers: [publisher],
    },
  });

  const signed = signManifest(unsigned, deps.signerKeyHex);
  const hash = manifestHash(signed);

  const manifestUpload = await deps.uploader.upload(utf8Bytes(JSON.stringify(signed)), [
    appTag(),
    epochTag(epochNumber),
    { name: 'Type', value: 'manifest' },
  ]);

  if (deps.leafIndexCheck !== undefined) {
    await verifyUploadedLeaves({
      epoch: deps.epoch,
      publisher,
      epochNumber,
      gatewayUrl: deps.leafIndexCheck.gatewayUrl,
      graphqlUrl: deps.leafIndexCheck.graphqlUrl,
      fetchImpl: deps.leafIndexCheck.fetchImpl,
      timeoutMs: deps.leafIndexCheck.timeoutMs,
      pollIntervalMs: deps.leafIndexCheck.pollIntervalMs,
      sleep: deps.leafIndexCheck.sleep,
    });
  }

  const txHash = await deps.chainPublisher.publishEpoch({
    merkleRoot: sha256ContentIdToBytes32(deps.epoch.merkleRoot),
    jsonlSha256: sha256ContentIdToBytes32(deps.epoch.jsonlSha256),
    manifestHash: sha256ContentIdToBytes32(hash),
    parentRoot: ZERO_BYTES32,
    manifestUri: manifestUpload.uri,
  });

  return {
    publisher,
    jsonlUri,
    manifestUri: manifestUpload.uri,
    manifestHash: hash,
    txHash,
    leafCount: deps.epoch.leaves.size,
    manifest: signed,
  };
}

export type {
  ChainPublisher,
  PublishEpochArgs,
  PublishGenesisReport,
  UploadResult,
  UploadTag,
  Uploader,
} from './adapters/types.js';
