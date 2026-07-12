import type { SignedManifest } from '../types.js';

export interface UploadTag {
  name: string;
  value: string;
}

export interface UploadResult {
  id: string;
  uri: string;
}

export interface Uploader {
  upload(data: Uint8Array, tags: UploadTag[]): Promise<UploadResult>;
}

export interface PublishEpochArgs {
  merkleRoot: `0x${string}`;
  jsonlSha256: `0x${string}`;
  manifestHash: `0x${string}`;
  parentRoot: `0x${string}`;
  manifestUri: string;
}

export interface ChainPublisher {
  publishEpoch(args: PublishEpochArgs): Promise<`0x${string}`>;
}

export interface PublishGenesisReport {
  publisher: string;
  jsonlUri: string;
  manifestUri: string;
  manifestHash: string;
  txHash: `0x${string}`;
  leafCount: number;
  manifest: SignedManifest;
}
