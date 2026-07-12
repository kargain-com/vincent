import type { Manifest, ReviewPolicy, UnsignedManifest } from '@kargain/vincent/protocol';

export interface BuildManifestInput {
  epoch: number;
  /** Prior epoch merkleRoot; null or zero hash for genesis. */
  parentRoot: string | null;
  merkleRoot: string;
  jsonlSha256: string;
  uris: string[];
  compiler: { name: string; version: string };
  reviewPolicy?: ReviewPolicy;
}

export type SignedManifest = Manifest;

export type { UnsignedManifest };

export type ManifestVerifyResult =
  | { ok: true; publisher: string }
  | { ok: false; reason: string };
