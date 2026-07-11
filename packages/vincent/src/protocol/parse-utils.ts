import { VIN_ALPHABET } from '../constants.js';
import {
  AR_URI_RE,
  ATTRIBUTE_NAME_RE,
  CLAIM_TYPES,
  CLAIM_TYPES_V10,
  CYCLE_RULES,
  PROVENANCE_VALUES,
  SHA256_HASH_RE,
  SIGNATURE_RE,
} from './constants.js';
import type { ClaimSchemaVersion, ClaimType, ParseError, ParseResult } from './types.js';

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

export function parseClaimSchemaVersion(
  value: unknown,
  claimType: ClaimType,
): ParseResult<ClaimSchemaVersion> {
  if (typeof value !== 'string') {
    return fail('unsupported-schema-version', 'schemaVersion must be a string');
  }
  const major = value.split('.')[0];
  if (major !== '1') {
    return fail('unsupported-schema-major', `Unsupported schema major version: ${major}`);
  }

  const expectedMinor = (CLAIM_TYPES_V10 as readonly string[]).includes(claimType) ? '1.0' : '1.1';
  if (value !== expectedMinor) {
    return fail(
      'unsupported-schema-version',
      `schemaVersion must be "${expectedMinor}" for claim type "${claimType}"`,
    );
  }

  if (value === '1.0') {
    return { ok: true, value: '1.0' };
  }
  return { ok: true, value: '1.1' };
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

export function parseBindingWmi(value: unknown, field: string): ParseResult<string> {
  const str = parseNonEmptyString(value, field);
  if (!str.ok) {
    return str;
  }
  if (str.value.length !== 3 && str.value.length !== 6) {
    return fail(`invalid-${field}`, `${field} must be exactly 3 or 6 characters`);
  }
  for (const char of str.value) {
    if (!VIN_ALPHABET.includes(char)) {
      return fail(`invalid-${field}`, `${field} contains invalid VIN character: ${char}`);
    }
  }
  return str;
}

export function parseModelYear(value: unknown, field: string): ParseResult<number> {
  if (typeof value !== 'number' || !Number.isInteger(value)) {
    return fail(`invalid-${field}`, `${field} must be an integer`);
  }
  return { ok: true, value };
}

export function parseYearTo(value: unknown): ParseResult<number | null> {
  if (value === null) {
    return { ok: true, value: null };
  }
  return parseModelYear(value, 'yearTo');
}

export function parseEmptyObject(value: unknown, field: string): ParseResult<Record<string, never>> {
  if (!isPlainObject(value)) {
    return fail(`invalid-${field}`, `${field} must be an object`);
  }
  if (Object.keys(value).length !== 0) {
    return fail(`invalid-${field}`, `${field} must be an empty object`);
  }
  return { ok: true, value: {} };
}

export function parseAttributeName(value: unknown): ParseResult<string> {
  const str = parseNonEmptyString(value, 'attribute');
  if (!str.ok) {
    return str;
  }
  if (!ATTRIBUTE_NAME_RE.test(str.value)) {
    return fail('invalid-attribute', 'attribute must be a well-formed camelCase token');
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
