export interface LeafBinding {
  yearFrom: number;
  yearTo: number | null;
  schemaRef: string;
}

export interface LeafPattern {
  match: { vds: string; vis?: string };
  attribute: string;
  code: string;
}

export interface LeafSchema {
  patterns: LeafPattern[];
}

export interface PartitionEntry {
  yearFrom: number;
  yearTo: number | null;
  key: string;
  leafHash: string;
}

export interface PartitionManifest {
  wmi: string;
  partitioned: true;
  partitions: PartitionEntry[];
}

/**
 * Self-contained per-WMI leaf (wire format = decode input).
 */
export interface DecodeLeaf {
  wmi: string;
  bindings: LeafBinding[];
  schemas: Record<string, LeafSchema>;
}

export type WireLeaf = DecodeLeaf | PartitionManifest;

/** Sibling hash with side relative to the proved path node (RFC 6962–style). */
export type MerkleProof = Array<{ hash: string; side: 'left' | 'right' }>;

/**
 * Untrusted leaf provider. Caller fetches from Arweave/memory/etc.;
 * every leaf MUST be verified against the anchored merkleRoot.
 */
export type GetLeaf = (
  wmi: string,
) => Promise<{ leaf: Uint8Array | string; proof: MerkleProof }>;
