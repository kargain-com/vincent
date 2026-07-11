/** Claim type discriminator per PROTOCOL.md §4.2. */
export type ClaimType =
  | 'wmi'
  | 'vds-schema'
  | 'vds-binding'
  | 'vds-pattern'
  | 'year-hint';

/** Wire schemaVersion minors for claims per PROTOCOL.md §4.2 and §4.5. */
export type ClaimSchemaVersion = '1.0' | '1.1';

/** Provenance taxonomy per PROTOCOL.md §4.6. */
export type Provenance =
  | 'regulatory/us-vpic'
  | 'community/observation'
  | 'community/document'
  | 'oem';

/** Genesis profile attribute registry per PROTOCOL.md §4.2 (documented, not closed at parse). */
export type VehicleAttribute =
  | 'model'
  | 'series'
  | 'bodyType'
  | 'fuelType'
  | 'driveType'
  | 'transmission'
  | 'engine'
  | 'engineCylinders'
  | 'displacementL'
  | 'plant';

/** Model-year cycle rule per PROTOCOL.md §4.2. */
export type CycleRule = 'iso-unreliable' | 'na-standard';

/** Match grammar token kinds per PROTOCOL.md §4.3. */
export type MatchLiteralToken = { kind: 'literal'; char: string };
export type MatchWildcardToken = { kind: 'wildcard' };
export type MatchClassToken = { kind: 'class'; chars: readonly string[] };
export type MatchToken = MatchLiteralToken | MatchWildcardToken | MatchClassToken;

/** Parsed match expression (grammar validation only; no VIN matching). */
export interface MatchExpression {
  vds: MatchToken[];
  vis?: MatchToken[];
}

/** Shared claim fields per PROTOCOL.md §4.1. */
export interface ClaimBaseV10 {
  schemaVersion: '1.0';
  provenance: Provenance;
  license: 'CC0-1.0';
  contributor: string;
  signature: string;
  evidence?: string[];
  supersedes?: string;
}

export interface ClaimBaseV11 {
  schemaVersion: '1.1';
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

export interface WmiClaim extends ClaimBaseV10 {
  type: 'wmi';
  key: WmiClaimKey;
  value: WmiClaimValue;
}

export interface VdsSchemaClaimKey {
  name: string;
}

export interface VdsSchemaClaim extends ClaimBaseV11 {
  type: 'vds-schema';
  key: VdsSchemaClaimKey;
  value: Record<string, never>;
}

export interface VdsBindingClaimKey {
  wmi: string;
  yearFrom: number;
  yearTo: number | null;
  schema: string;
}

export interface VdsBindingClaim extends ClaimBaseV11 {
  type: 'vds-binding';
  key: VdsBindingClaimKey;
  value: Record<string, never>;
}

export interface VdsPatternMatchKey {
  vds: string;
  vis?: string;
}

export interface VdsPatternClaimKey {
  schema: string;
  match: VdsPatternMatchKey;
}

export interface VdsPatternClaimValue {
  attribute: string;
  code: string;
}

export interface VdsPatternClaim extends ClaimBaseV11 {
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

export interface YearHintClaim extends ClaimBaseV10 {
  type: 'year-hint';
  key: YearHintClaimKey;
  value: YearHintClaimValue;
}

/** Signed claim union per PROTOCOL.md §4.2. */
export type Claim =
  | WmiClaim
  | VdsSchemaClaim
  | VdsBindingClaim
  | VdsPatternClaim
  | YearHintClaim;

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
