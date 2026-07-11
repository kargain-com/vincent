import type { ClaimType, CycleRule, Provenance, VehicleAttribute } from './types.js';

/** Allowed top-level keys for claims (§4.1). */
export const CLAIM_TOP_LEVEL_KEYS = new Set([
  'schemaVersion',
  'type',
  'key',
  'value',
  'evidence',
  'provenance',
  'license',
  'supersedes',
  'contributor',
  'signature',
]);

/** Required top-level keys for claims. */
export const CLAIM_REQUIRED_KEYS = new Set([
  'schemaVersion',
  'type',
  'key',
  'value',
  'provenance',
  'license',
  'contributor',
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

/** Required top-level keys for manifests (parent is epoch-dependent). */
export const MANIFEST_REQUIRED_KEYS = new Set([
  'schemaVersion',
  'epoch',
  'reviewPolicy',
  'claims',
  'compiler',
  'dataset',
  'publisher',
  'signature',
]);

export const CLAIM_TYPES: readonly ClaimType[] = [
  'wmi',
  'vds-pattern',
  'year-hint',
];

export const PROVENANCE_VALUES: readonly Provenance[] = [
  'regulatory/us-vpic',
  'community/observation',
  'community/document',
  'oem',
];

export const VEHICLE_ATTRIBUTES: readonly VehicleAttribute[] = [
  'model',
  'series',
  'bodyType',
  'fuelType',
  'driveType',
  'transmission',
  'engine',
  'restraint',
  'gvwrClass',
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

/** VIN alphabet chars plus wildcard for VDS patterns. */
export const VDS_PATTERN_CHARS = '0123456789ABCDEFGHJKLMNPRSTUVWXYZ*';

/** Positions range within VDS positions 4–8. */
export const POSITIONS_RE = /^([4-8])-([4-8])$/;
