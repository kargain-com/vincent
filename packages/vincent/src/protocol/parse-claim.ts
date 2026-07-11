import {
  CLAIM_REQUIRED_KEYS,
  CLAIM_TOP_LEVEL_KEYS,
} from './constants.js';
import {
  checkObjectKeys,
  checkRequiredKeys,
  checkTopLevelKeys,
  fail,
  isPlainObject,
  parseAddress,
  parseClaimType,
  parseCycleRule,
  parseEvidence,
  parsePlainObject,
  parsePositions,
  parseProvenance,
  parseSchemaVersion,
  parseSha256Hash,
  parseSignature,
  parseVehicleAttribute,
  parseVdsPattern,
  parseWmiCode,
  parseNonEmptyString,
  rejectNullOptional,
} from './parse-utils.js';
import type {
  Claim,
  CycleRule,
  ParseResult,
  VehicleAttribute,
  VdsPatternClaim,
  WmiClaim,
  YearHintClaim,
} from './types.js';

const WMI_KEY_KEYS = new Set(['wmi']);
const WMI_VALUE_KEYS = new Set(['manufacturer', 'country', 'region']);
const VDS_KEY_KEYS = new Set(['wmi', 'positions', 'pattern']);
const VDS_VALUE_KEYS = new Set(['attribute', 'code']);
const YEAR_VALUE_KEYS = new Set(['cycleRule']);

function parseWmiKey(value: unknown): ParseResult<{ wmi: string }> {
  const obj = parsePlainObject(value, 'key');
  if (!obj.ok) {
    return obj;
  }
  const keys = checkObjectKeys(obj.value, WMI_KEY_KEYS, 'key');
  if (!keys.ok) {
    return keys;
  }
  if (!('wmi' in obj.value)) {
    return fail('missing-key:wmi', 'Missing required key in key: wmi');
  }
  const wmi = parseWmiCode(obj.value.wmi, 'wmi');
  if (!wmi.ok) {
    return wmi;
  }
  return { ok: true, value: { wmi: wmi.value } };
}

function parseWmiValue(value: unknown): ParseResult<{
  manufacturer: string;
  country: string;
  region: string;
}> {
  const obj = parsePlainObject(value, 'value');
  if (!obj.ok) {
    return obj;
  }
  const keys = checkObjectKeys(obj.value, WMI_VALUE_KEYS, 'value');
  if (!keys.ok) {
    return keys;
  }
  for (const key of WMI_VALUE_KEYS) {
    if (!(key in obj.value)) {
      return fail(`missing-key:${key}`, `Missing required key in value: ${key}`);
    }
  }
  const manufacturer = parseNonEmptyString(obj.value.manufacturer, 'manufacturer');
  if (!manufacturer.ok) {
    return manufacturer;
  }
  const country = parseNonEmptyString(obj.value.country, 'country');
  if (!country.ok) {
    return country;
  }
  const region = parseNonEmptyString(obj.value.region, 'region');
  if (!region.ok) {
    return region;
  }
  return {
    ok: true,
    value: {
      manufacturer: manufacturer.value,
      country: country.value,
      region: region.value,
    },
  };
}

function parseVdsKey(value: unknown): ParseResult<{
  wmi: string;
  positions: string;
  pattern: string;
}> {
  const obj = parsePlainObject(value, 'key');
  if (!obj.ok) {
    return obj;
  }
  const keys = checkObjectKeys(obj.value, VDS_KEY_KEYS, 'key');
  if (!keys.ok) {
    return keys;
  }
  for (const key of VDS_KEY_KEYS) {
    if (!(key in obj.value)) {
      return fail(`missing-key:${key}`, `Missing required key in key: ${key}`);
    }
  }
  const wmi = parseWmiCode(obj.value.wmi, 'wmi');
  if (!wmi.ok) {
    return wmi;
  }
  const positions = parsePositions(obj.value.positions);
  if (!positions.ok) {
    return positions;
  }
  const rangeLength = positions.value.end - positions.value.start + 1;
  const pattern = parseVdsPattern(obj.value.pattern, rangeLength);
  if (!pattern.ok) {
    return pattern;
  }
  return {
    ok: true,
    value: {
      wmi: wmi.value,
      positions: obj.value.positions as string,
      pattern: pattern.value,
    },
  };
}

function parseVdsValue(value: unknown): ParseResult<{ attribute: string; code: string }> {
  const obj = parsePlainObject(value, 'value');
  if (!obj.ok) {
    return obj;
  }
  const keys = checkObjectKeys(obj.value, VDS_VALUE_KEYS, 'value');
  if (!keys.ok) {
    return keys;
  }
  for (const key of VDS_VALUE_KEYS) {
    if (!(key in obj.value)) {
      return fail(`missing-key:${key}`, `Missing required key in value: ${key}`);
    }
  }
  const attribute = parseVehicleAttribute(obj.value.attribute);
  if (!attribute.ok) {
    return attribute;
  }
  const code = parseNonEmptyString(obj.value.code, 'code');
  if (!code.ok) {
    return code;
  }
  return { ok: true, value: { attribute: attribute.value, code: code.value } };
}

function parseYearHintKey(value: unknown): ParseResult<{ wmi: string }> {
  return parseWmiKey(value);
}

function parseYearHintValue(value: unknown): ParseResult<{ cycleRule: string }> {
  const obj = parsePlainObject(value, 'value');
  if (!obj.ok) {
    return obj;
  }
  const keys = checkObjectKeys(obj.value, YEAR_VALUE_KEYS, 'value');
  if (!keys.ok) {
    return keys;
  }
  if (!('cycleRule' in obj.value)) {
    return fail('missing-key:cycleRule', 'Missing required key in value: cycleRule');
  }
  const cycleRule = parseCycleRule(obj.value.cycleRule);
  if (!cycleRule.ok) {
    return cycleRule;
  }
  return { ok: true, value: { cycleRule: cycleRule.value } };
}

/** Parse and validate a claim document (fail-closed, no exceptions). */
export function parseClaim(json: unknown): ParseResult<Claim> {
  if (!isPlainObject(json)) {
    return fail('invalid-type', 'Claim must be a JSON object');
  }

  const topKeys = checkTopLevelKeys(json, CLAIM_TOP_LEVEL_KEYS);
  if (!topKeys.ok) {
    return topKeys;
  }

  const required = checkRequiredKeys(json, CLAIM_REQUIRED_KEYS);
  if (!required.ok) {
    return required;
  }

  for (const optional of ['evidence', 'supersedes'] as const) {
    if (optional in json) {
      const nullCheck = rejectNullOptional(optional, json[optional]);
      if (!nullCheck.ok) {
        return nullCheck;
      }
    }
  }

  const schemaVersion = parseSchemaVersion(json.schemaVersion);
  if (!schemaVersion.ok) {
    return schemaVersion;
  }

  if (json.license !== 'CC0-1.0') {
    return fail('invalid-license', 'license must be CC0-1.0');
  }

  const claimType = parseClaimType(json.type);
  if (!claimType.ok) {
    return claimType;
  }

  const provenance = parseProvenance(json.provenance);
  if (!provenance.ok) {
    return provenance;
  }

  const contributor = parseAddress(json.contributor, 'contributor');
  if (!contributor.ok) {
    return contributor;
  }

  const signature = parseSignature(json.signature);
  if (!signature.ok) {
    return signature;
  }

  const evidence = parseEvidence(json.evidence);
  if (!evidence.ok) {
    return evidence;
  }

  let supersedes: string | undefined;
  if ('supersedes' in json) {
    const hash = parseSha256Hash(json.supersedes, 'supersedes');
    if (!hash.ok) {
      return hash;
    }
    supersedes = hash.value;
  }

  const base = {
    schemaVersion: schemaVersion.value,
    provenance: provenance.value,
    license: 'CC0-1.0' as const,
    contributor: contributor.value,
    signature: signature.value,
    ...(evidence.value !== undefined ? { evidence: evidence.value } : {}),
    ...(supersedes !== undefined ? { supersedes } : {}),
  };

  switch (claimType.value) {
    case 'wmi': {
      const key = parseWmiKey(json.key);
      if (!key.ok) {
        return key;
      }
      const value = parseWmiValue(json.value);
      if (!value.ok) {
        return value;
      }
      return {
        ok: true,
        value: { ...base, type: 'wmi', key: key.value, value: value.value } satisfies WmiClaim,
      };
    }
    case 'vds-pattern': {
      const key = parseVdsKey(json.key);
      if (!key.ok) {
        return key;
      }
      const value = parseVdsValue(json.value);
      if (!value.ok) {
        return value;
      }
      return {
        ok: true,
        value: {
          ...base,
          type: 'vds-pattern',
          key: key.value,
          value: {
            attribute: value.value.attribute as VehicleAttribute,
            code: value.value.code,
          },
        } satisfies VdsPatternClaim,
      };
    }
    case 'year-hint': {
      const key = parseYearHintKey(json.key);
      if (!key.ok) {
        return key;
      }
      const value = parseYearHintValue(json.value);
      if (!value.ok) {
        return value;
      }
      return {
        ok: true,
        value: {
          ...base,
          type: 'year-hint',
          key: key.value,
          value: {
            cycleRule: value.value.cycleRule as CycleRule,
          },
        } satisfies YearHintClaim,
      };
    }
  }
}
