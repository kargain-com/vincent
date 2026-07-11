import { VIN_ALPHABET } from '../constants.js';
import {
  AR_URI_RE,
  CLAIM_TYPES,
  CYCLE_RULES,
  POSITIONS_RE,
  PROVENANCE_VALUES,
  SHA256_HASH_RE,
  SIGNATURE_RE,
  VDS_PATTERN_CHARS,
  VEHICLE_ATTRIBUTES,
} from './constants.js';
import type { ParseError, ParseResult } from './types.js';

export function parseError(code: string, message: string): ParseError {
  return { code, message };
}

export function fail<T>(code: string, message: string): ParseResult<T> {
  return { ok: false, error: parseError(code, message) };
}

export function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

export function checkTopLevelKeys(
  obj: Record<string, unknown>,
  allowed: Set<string>,
): ParseResult<void> {
  for (const key of Object.keys(obj)) {
    if (!allowed.has(key)) {
      return fail(`unknown-key:${key}`, `Unknown top-level key: ${key}`);
    }
  }
  return { ok: true, value: undefined };
}

export function checkRequiredKeys(
  obj: Record<string, unknown>,
  required: Set<string>,
): ParseResult<void> {
  for (const key of required) {
    if (!(key in obj)) {
      return fail(`missing-key:${key}`, `Missing required key: ${key}`);
    }
  }
  return { ok: true, value: undefined };
}

export function rejectNullOptional(key: string, value: unknown): ParseResult<void> {
  if (value === null) {
    return fail(`null-optional:${key}`, `Optional key must not be null: ${key}`);
  }
  return { ok: true, value: undefined };
}

export function parseSchemaVersion(value: unknown): ParseResult<'1.0'> {
  if (typeof value !== 'string') {
    return fail('unsupported-schema-version', 'schemaVersion must be a string');
  }
  const major = value.split('.')[0];
  if (major !== '1') {
    return fail('unsupported-schema-major', `Unsupported schema major version: ${major}`);
  }
  if (value !== '1.0') {
    return fail('unsupported-schema-version', `Unsupported schemaVersion: ${value}`);
  }
  return { ok: true, value: '1.0' };
}

export function parseSha256Hash(value: unknown, field: string): ParseResult<string> {
  if (typeof value !== 'string' || !SHA256_HASH_RE.test(value)) {
    return fail('invalid-hash', `Invalid sha256 hash for ${field}`);
  }
  return { ok: true, value };
}

export function parseAddress(value: unknown, field: string): ParseResult<string> {
  if (typeof value !== 'string' || !/^0x[0-9a-fA-F]{40}$/.test(value)) {
    return fail('invalid-address', `Invalid address for ${field}`);
  }
  return { ok: true, value };
}

export function parseSignature(value: unknown): ParseResult<string> {
  if (typeof value !== 'string' || !SIGNATURE_RE.test(value)) {
    return fail('invalid-signature', 'Invalid signature format');
  }
  return { ok: true, value };
}

export function parseNonEmptyString(value: unknown, field: string): ParseResult<string> {
  if (typeof value !== 'string' || value.length === 0) {
    return fail(`invalid-${field}`, `${field} must be a non-empty string`);
  }
  return { ok: true, value };
}

export function parseWmiCode(value: unknown, field: string): ParseResult<string> {
  const str = parseNonEmptyString(value, field);
  if (!str.ok) {
    return str;
  }
  if (str.value.length !== 3) {
    return fail(`invalid-${field}`, `${field} must be exactly 3 characters`);
  }
  for (const char of str.value) {
    if (!VIN_ALPHABET.includes(char)) {
      return fail(`invalid-${field}`, `${field} contains invalid VIN character: ${char}`);
    }
  }
  return str;
}

export function parseEvidence(value: unknown): ParseResult<string[] | undefined> {
  if (value === undefined) {
    return { ok: true, value: undefined };
  }
  if (!Array.isArray(value)) {
    return fail('invalid-evidence', 'evidence must be an array of ar:// URIs');
  }
  if (value.length === 0) {
    return fail('invalid-evidence', 'evidence must be omitted when empty, not an empty array');
  }
  for (const item of value) {
    if (typeof item !== 'string' || !AR_URI_RE.test(item)) {
      return fail('invalid-evidence', 'Each evidence entry must be an ar:// URI');
    }
  }
  return { ok: true, value };
}

export function parseProvenance(value: unknown): ParseResult<(typeof PROVENANCE_VALUES)[number]> {
  if (
    typeof value !== 'string' ||
    !(PROVENANCE_VALUES as readonly string[]).includes(value)
  ) {
    return fail('invalid-provenance', 'Invalid provenance value');
  }
  return { ok: true, value: value as (typeof PROVENANCE_VALUES)[number] };
}

export function parseClaimType(value: unknown): ParseResult<(typeof CLAIM_TYPES)[number]> {
  if (typeof value !== 'string' || !(CLAIM_TYPES as readonly string[]).includes(value)) {
    return fail('invalid-claim-type', 'Invalid claim type');
  }
  return { ok: true, value: value as (typeof CLAIM_TYPES)[number] };
}

export function parsePositions(value: unknown): ParseResult<{ start: number; end: number }> {
  if (typeof value !== 'string') {
    return fail('invalid-positions', 'positions must be a string');
  }
  const match = POSITIONS_RE.exec(value);
  if (!match) {
    return fail('invalid-positions', 'positions must be an inclusive range within 4-8');
  }
  const start = Number(match[1]);
  const end = Number(match[2]);
  if (start > end) {
    return fail('invalid-positions', 'positions start must not exceed end');
  }
  return { ok: true, value: { start, end } };
}

export function parseVdsPattern(value: unknown, rangeLength: number): ParseResult<string> {
  if (typeof value !== 'string') {
    return fail('invalid-pattern', 'pattern must be a string');
  }
  if (value.length !== rangeLength) {
    return fail('invalid-pattern', 'pattern length must equal positions range length');
  }
  for (const char of value) {
    if (!VDS_PATTERN_CHARS.includes(char)) {
      return fail('invalid-pattern', `pattern contains invalid character: ${char}`);
    }
  }
  return { ok: true, value };
}

export function parseVehicleAttribute(
  value: unknown,
): ParseResult<(typeof VEHICLE_ATTRIBUTES)[number]> {
  if (typeof value !== 'string' || !(VEHICLE_ATTRIBUTES as readonly string[]).includes(value)) {
    return fail('invalid-attribute', 'Invalid vehicle attribute');
  }
  return { ok: true, value: value as (typeof VEHICLE_ATTRIBUTES)[number] };
}

export function parseCycleRule(value: unknown): ParseResult<(typeof CYCLE_RULES)[number]> {
  if (typeof value !== 'string' || !(CYCLE_RULES as readonly string[]).includes(value)) {
    return fail('invalid-cycle-rule', 'Invalid cycleRule value');
  }
  return { ok: true, value: value as (typeof CYCLE_RULES)[number] };
}

export function isSortedAscending(values: string[]): boolean {
  for (let i = 1; i < values.length; i++) {
    if (values[i - 1].localeCompare(values[i]) > 0) {
      return false;
    }
  }
  return true;
}

export function parsePlainObject(value: unknown, field: string): ParseResult<Record<string, unknown>> {
  if (!isPlainObject(value)) {
    return fail(`invalid-${field}`, `${field} must be an object`);
  }
  return { ok: true, value };
}

export function checkObjectKeys(
  obj: Record<string, unknown>,
  allowed: Set<string>,
  field: string,
): ParseResult<void> {
  for (const key of Object.keys(obj)) {
    if (!allowed.has(key)) {
      return fail(`invalid-${field}`, `Unknown key in ${field}: ${key}`);
    }
  }
  return { ok: true, value: undefined };
}
