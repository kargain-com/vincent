import type { ClaimType } from '@kargain/vincent/protocol';

import type { MerkleProof } from './merkle.js';

/** Compile-time error (fail-closed, no exceptions). */
export interface CompileError {
  code: string;
  message: string;
}

/** Discriminated compile result. */
export type CompileResult<T> =
  | { ok: true; value: T }
  | { ok: false; error: CompileError };

/** Anchor-order policy for same-key conflict resolution (§7.2). */
export interface CompilePolicy {
  /** Claim hashes in anchor-priority order; lower index wins on conflict. */
  anchorOrder?: readonly string[];
  /** Explicit anchor ranks; when set for a hash, overrides index-derived rank. */
  anchorRank?: Readonly<Record<string, number>>;
  /** Optional progress callback for long compiles. */
  progress?: (message: string) => void;
  /** Override leaf size cap (bytes); default LEAF_CAP_BYTES. Tests only. */
  leafCapBytes?: number;
}

export interface CompileStageTimingMs {
  prepare: number;
  anchor: number;
  supersession: number;
  conflict: number;
  sort: number;
  jsonl: number;
  leaves: number;
  merkle: number;
}

/** Per-WMI leaf artifact with Merkle inclusion proof. */
export interface EpochLeaf {
  leaf: string;
  leafHash: string;
  proof: MerkleProof;
}

/** Compiled epoch artifacts. */
export interface EpochBuild {
  jsonl: string;
  jsonlSha256: string;
  merkleRoot: string;
  leaves: Map<string, EpochLeaf>;
  claimCount: number;
  byType: Record<ClaimType, number>;
  stageTimingMs: CompileStageTimingMs;
}

/** verifyEpoch result. */
export type VerifyEpochResult = { ok: true } | { ok: false; reason: string };

export function fail(code: string, message: string): { ok: false; error: CompileError } {
  return { ok: false, error: { code, message } };
}

export function emptyByType(): Record<ClaimType, number> {
  return {
    wmi: 0,
    'vds-schema': 0,
    'vds-binding': 0,
    'vds-pattern': 0,
    'year-hint': 0,
  };
}
