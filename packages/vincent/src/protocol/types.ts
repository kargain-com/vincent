/** Claim type discriminator per PROTOCOL.md §4.2. */
export type ClaimType = 'wmi' | 'vds-pattern' | 'year-hint';

/** Provenance taxonomy per PROTOCOL.md §4.3. */
export type Provenance =
  | 'regulatory/us-vpic'
  | 'community/observation'
  | 'community/document'
  | 'oem';

/** Canonical vehicle attribute enum per PROTOCOL.md §4.2. */
export type VehicleAttribute =
  | 'model'
  | 'series'
  | 'bodyType'
  | 'fuelType'
  | 'driveType'
  | 'transmission'
  | 'engine'
  | 'restraint'
  | 'gvwrClass'
  | 'plant';

/** Model-year cycle rule per PROTOCOL.md §4.2. */
export type CycleRule = 'iso-unreliable' | 'na-standard';

/** Shared claim fields per PROTOCOL.md §4.1. */
export interface ClaimBase {
  schemaVersion: '1.0';
  provenance: Provenance;
  license: 'CC0-1.0';
  contributor: string;
  signature: string;
  evidence?: string[];
  supersedes?: string;
}

export interface WmiClaimKey {
  wmi: string;
}

export interface WmiClaimValue {
  manufacturer: string;
  country: string;
  region: string;
}

export interface WmiClaim extends ClaimBase {
  type: 'wmi';
  key: WmiClaimKey;
  value: WmiClaimValue;
}

export interface VdsPatternClaimKey {
  wmi: string;
  positions: string;
  pattern: string;
}

export interface VdsPatternClaimValue {
  attribute: VehicleAttribute;
  code: string;
}

export interface VdsPatternClaim extends ClaimBase {
  type: 'vds-pattern';
  key: VdsPatternClaimKey;
  value: VdsPatternClaimValue;
}

export interface YearHintClaimKey {
  wmi: string;
}

export interface YearHintClaimValue {
  cycleRule: CycleRule;
}

export interface YearHintClaim extends ClaimBase {
  type: 'year-hint';
  key: YearHintClaimKey;
  value: YearHintClaimValue;
}

/** Signed claim union per PROTOCOL.md §4.2. */
export type Claim = WmiClaim | VdsPatternClaim | YearHintClaim;

/** Unsigned claim input for signing (address filled by signer). */
export type UnsignedClaim = Omit<Claim, 'signature' | 'contributor'> & {
  contributor?: string;
  signature?: never;
};

export interface ReviewPolicy {
  minAccepts: number;
  reviewers: string[];
}

export interface CompilerInfo {
  name: string;
  version: string;
}

export interface DatasetInfo {
  jsonlSha256: string;
  sqliteSha256: string;
  uris: string[];
}

/** Manifest wire format per PROTOCOL.md §7.1. */
export interface Manifest {
  schemaVersion: '1.0';
  epoch: number;
  parent?: string;
  reviewPolicy: ReviewPolicy;
  claims: string[];
  compiler: CompilerInfo;
  dataset: DatasetInfo;
  publisher: string;
  signature: string;
}

/** Unsigned manifest input for signing (address filled by signer). */
export type UnsignedManifest = Omit<Manifest, 'signature' | 'publisher'> & {
  publisher?: string;
  signature?: never;
};

/** Typed parse failure (no exceptions). */
export interface ParseError {
  code: string;
  message: string;
}

/** Discriminated parse result. */
export type ParseResult<T> =
  | { ok: true; value: T }
  | { ok: false; error: ParseError };

/** Signature verification result. */
export type VerifyResult =
  | { ok: true }
  | { ok: false; reason: string };
