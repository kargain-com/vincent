import type { AttestationKind, ClaimType, CycleRule, Provenance, VehicleAttribute } from './types.js';

/** Allowed top-level keys for claim fact cores (§4.1). */
export const CLAIM_TOP_LEVEL_KEYS = new Set([
  'schemaVersion',
  'type',
  'key',
  'value',
  'evidence',
  'provenance',
  'license',
  'supersedes',
]);

/** Required top-level keys for claim fact cores. */
export const CLAIM_REQUIRED_KEYS = new Set([
  'schemaVersion',
  'type',
  'key',
  'value',
  'provenance',
  'license',
]);

/** Allowed top-level keys for attestations (§4.9). */
export const ATTESTATION_TOP_LEVEL_KEYS = new Set([
  'schemaVersion',
  'claim',
  'attester',
  'kind',
  'signature',
]);

/** Required top-level keys for attestations. */
export const ATTESTATION_REQUIRED_KEYS = new Set([
  'schemaVersion',
  'claim',
  'attester',
  'kind',
  'signature',
]);

/** Allowed top-level keys for manifests (§7.1). */
export const MANIFEST_TOP_LEVEL_KEYS = new Set([
  'schemaVersion',
  'epoch',
  'parent',
  'reviewPolicy',
  'claims',
  'compiler',
  'dataset',
  'publisher',
  'signature',
]);

/** Required top-level keys for manifests. */
export const MANIFEST_REQUIRED_KEYS = new Set([
  'schemaVersion',
  'epoch',
  'parent',
  'reviewPolicy',
  'compiler',
  'dataset',
  'publisher',
  'signature',
]);

export const CLAIM_TYPES: readonly ClaimType[] = [
  'wmi',
  'vds-schema',
  'vds-binding',
  'vds-pattern',
  'year-hint',
];

/** Claim types that require schemaVersion "1.0". */
export const CLAIM_TYPES_V10: readonly ClaimType[] = ['wmi', 'year-hint'];

/** Claim types that require schemaVersion "1.1". */
export const CLAIM_TYPES_V11: readonly ClaimType[] = [
  'vds-schema',
  'vds-binding',
  'vds-pattern',
];

export const ATTESTATION_KINDS: readonly AttestationKind[] = ['endorse'];

export const PROVENANCE_VALUES: readonly Provenance[] = [
  'regulatory/us-vpic',
  'community/observation',
  'community/document',
  'oem',
];

/** Genesis profile attribute registry per PROTOCOL.md §4.2. */
export const VEHICLE_ATTRIBUTES: readonly VehicleAttribute[] = [
  'model',
  'series',
  'bodyType',
  'fuelType',
  'driveType',
  'transmission',
  'engine',
  'engineCylinders',
  'displacementL',
  'plant',
];

export const CYCLE_RULES: readonly CycleRule[] = ['iso-unreliable', 'na-standard'];

/** sha256:<64 lowercase hex> */
export const SHA256_HASH_RE = /^sha256:[0-9a-f]{64}$/;

/** 0x + 40 hex (any case at parse; EIP-55 enforced at verify). */
export const ADDRESS_RE = /^0x[0-9a-fA-F]{40}$/;

/** 0x + 130 hex (65-byte signature). */
export const SIGNATURE_RE = /^0x[0-9a-fA-F]{130}$/;

/** ar:// URI for evidence. */
export const AR_URI_RE = /^ar:\/\/[A-Za-z0-9_-]+$/;

/** VIN alphabet chars allowed as match literals (I, O, Q excluded). */
export const MATCH_LITERAL_CHARS = '0123456789ABCDEFGHJKLMNPRSTUVWXYZ';

/** Well-formed attribute name: camelCase token. */
export const ATTRIBUTE_NAME_RE = /^[a-z][a-zA-Z0-9]*$/;
