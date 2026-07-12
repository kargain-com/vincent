import type { EpochBuild } from '@kargain/vincent-compiler';
import { addressFromPrivateKey, toChecksumAddress } from '@kargain/vincent/protocol';
import { gzipSync } from 'node:zlib';

import type { ChainPublisher, PublishGenesisReport, UploadTag, Uploader } from './adapters/types.js';
import { sha256ContentIdToBytes32 } from './adapters/sha256-bytes32.js';
import { assertGenesisPublisherAvailable } from './assert-genesis-publisher.js';
import { buildManifest } from './build-manifest.js';
import { DEFAULT_GENESIS_REVIEW_POLICY } from './constants.js';
import {
  preflightEpochPublish,
  type EpochPreflightOptions,
} from './preflight-genesis-publish.js';
import { resolveEpochParent, type EpochChainReader } from './resolve-epoch-parent.js';
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

export interface PublishEpochDeps {
  epoch: EpochBuild;
  signerKeyHex: string;
  uploader: Uploader;
  chainPublisher: ChainPublisher & EpochChainReader;
  compiler?: { name: string; version: string };
  /** When true, abort before upload if publisher already has on-chain epochs. */
  requireGenesis?: boolean;
  /** When set, run live preflight before any Arweave/Irys uploads. */
  preflight?: EpochPreflightOptions;
  /** When set, verify GraphQL leaf indexing before on-chain anchor. */
  leafIndexCheck?: LeafIndexCheckOptions;
}

export type PublishEpochReport = PublishGenesisReport;

function utf8Bytes(value: string): Uint8Array {
  return new TextEncoder().encode(value);
}

function epochTag(epochNumber: number): UploadTag {
  return { name: 'Epoch', value: String(epochNumber) };
}

function appTag(): UploadTag {
  return { name: 'App', value: 'vincent' };
}

/** Publish sequence: upload leaves + JSONL + manifest, then anchor on-chain. */
export async function publishEpoch(deps: PublishEpochDeps): Promise<PublishEpochReport> {
  const compiler = deps.compiler ?? DEFAULT_COMPILER;
  const publisher = toChecksumAddress(addressFromPrivateKey(deps.signerKeyHex));
  const publisherAddress = publisher as `0x${string}`;

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
    parentRoot: parentRootBytes32,
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
