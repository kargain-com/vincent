import {
  CLAIM_REQUIRED_KEYS,
  CLAIM_TOP_LEVEL_KEYS,
} from './constants.js';
import { parseMatchSegment } from './parse-match.js';
import {
  checkObjectKeys,
  checkRequiredKeys,
  checkTopLevelKeys,
  fail,
  isPlainObject,
  parseAddress,
  parseAttributeName,
  parseBindingWmi,
  parseClaimSchemaVersion,
  parseClaimType,
  parseCycleRule,
  parseEmptyObject,
  parseEvidence,
  parseModelYear,
  parsePlainObject,
  parseProvenance,
  parseSha256Hash,
  parseSignature,
  parseWmiCode,
  parseNonEmptyString,
  parseYearTo,
  rejectNullOptional,
} from './parse-utils.js';
import type {
  Claim,
  CycleRule,
  ParseResult,
  VdsBindingClaim,
  VdsPatternClaim,
  VdsSchemaClaim,
  WmiClaim,
  YearHintClaim,
} from './types.js';

const WMI_KEY_KEYS = new Set(['wmi']);
const WMI_VALUE_KEYS = new Set(['manufacturer', 'country', 'region']);
const VDS_SCHEMA_KEY_KEYS = new Set(['name']);
const VDS_BINDING_KEY_KEYS = new Set(['wmi', 'yearFrom', 'yearTo', 'schema']);
const VDS_PATTERN_KEY_KEYS = new Set(['schema', 'match']);
const VDS_PATTERN_MATCH_KEYS = new Set(['vds', 'vis']);
const VDS_PATTERN_VALUE_KEYS = new Set(['attribute', 'code']);
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

function parseVdsSchemaKey(value: unknown): ParseResult<{ name: string }> {
  const obj = parsePlainObject(value, 'key');
  if (!obj.ok) {
    return obj;
  }
  const keys = checkObjectKeys(obj.value, VDS_SCHEMA_KEY_KEYS, 'key');
  if (!keys.ok) {
    return keys;
  }
  if (!('name' in obj.value)) {
    return fail('missing-key:name', 'Missing required key in key: name');
  }
  const name = parseNonEmptyString(obj.value.name, 'name');
  if (!name.ok) {
    return name;
  }
  return { ok: true, value: { name: name.value } };
}

function parseVdsBindingKey(value: unknown): ParseResult<{
  wmi: string;
  yearFrom: number;
  yearTo: number | null;
  schema: string;
}> {
  const obj = parsePlainObject(value, 'key');
  if (!obj.ok) {
    return obj;
  }
  const keys = checkObjectKeys(obj.value, VDS_BINDING_KEY_KEYS, 'key');
  if (!keys.ok) {
    return keys;
  }
  for (const key of VDS_BINDING_KEY_KEYS) {
    if (!(key in obj.value)) {
      return fail(`missing-key:${key}`, `Missing required key in key: ${key}`);
    }
  }
  const wmi = parseBindingWmi(obj.value.wmi, 'wmi');
  if (!wmi.ok) {
    return wmi;
  }
  const yearFrom = parseModelYear(obj.value.yearFrom, 'yearFrom');
  if (!yearFrom.ok) {
    return yearFrom;
  }
  const yearTo = parseYearTo(obj.value.yearTo);
  if (!yearTo.ok) {
    return yearTo;
  }
  if (yearTo.value !== null && yearFrom.value > yearTo.value) {
    return fail('invalid-year-range', 'yearFrom must not exceed yearTo');
  }
  const schema = parseSha256Hash(obj.value.schema, 'schema');
  if (!schema.ok) {
    return schema;
  }
  return {
    ok: true,
    value: {
      wmi: wmi.value,
      yearFrom: yearFrom.value,
      yearTo: yearTo.value,
      schema: schema.value,
    },
  };
}

function parseVdsPatternMatch(value: unknown): ParseResult<{ vds: string; vis?: string }> {
  const obj = parsePlainObject(value, 'match');
  if (!obj.ok) {
    return obj;
  }
  const keys = checkObjectKeys(obj.value, VDS_PATTERN_MATCH_KEYS, 'match');
  if (!keys.ok) {
    return keys;
  }
  if (!('vds' in obj.value)) {
    return fail('missing-key:vds', 'Missing required key in match: vds');
  }
  if (typeof obj.value.vds !== 'string') {
    return fail('invalid-match', 'match.vds must be a string');
  }
  const vds = parseMatchSegment(obj.value.vds);
  if (!vds.ok) {
    return vds;
  }
  if ('vis' in obj.value) {
    if (typeof obj.value.vis !== 'string') {
      return fail('invalid-match', 'match.vis must be a string');
    }
    const vis = parseMatchSegment(obj.value.vis);
    if (!vis.ok) {
      return vis;
    }
    return { ok: true, value: { vds: obj.value.vds, vis: obj.value.vis } };
  }
  return { ok: true, value: { vds: obj.value.vds } };
}

function parseVdsPatternKey(value: unknown): ParseResult<{
  schema: string;
  match: { vds: string; vis?: string };
}> {
  const obj = parsePlainObject(value, 'key');
  if (!obj.ok) {
    return obj;
  }
  const keys = checkObjectKeys(obj.value, VDS_PATTERN_KEY_KEYS, 'key');
  if (!keys.ok) {
    return keys;
  }
  for (const key of VDS_PATTERN_KEY_KEYS) {
    if (!(key in obj.value)) {
      return fail(`missing-key:${key}`, `Missing required key in key: ${key}`);
    }
  }
  const schema = parseSha256Hash(obj.value.schema, 'schema');
  if (!schema.ok) {
    return schema;
  }
  const match = parseVdsPatternMatch(obj.value.match);
  if (!match.ok) {
    return match;
  }
  return {
    ok: true,
    value: {
      schema: schema.value,
      match: match.value,
    },
  };
}

function parseVdsPatternValue(value: unknown): ParseResult<{ attribute: string; code: string }> {
  const obj = parsePlainObject(value, 'value');
  if (!obj.ok) {
    return obj;
  }
  const keys = checkObjectKeys(obj.value, VDS_PATTERN_VALUE_KEYS, 'value');
  if (!keys.ok) {
    return keys;
  }
  for (const key of VDS_PATTERN_VALUE_KEYS) {
    if (!(key in obj.value)) {
      return fail(`missing-key:${key}`, `Missing required key in value: ${key}`);
    }
  }
  const attribute = parseAttributeName(obj.value.attribute);
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

  const claimType = parseClaimType(json.type);
  if (!claimType.ok) {
    return claimType;
  }

  const schemaVersion = parseClaimSchemaVersion(json.schemaVersion, claimType.value);
  if (!schemaVersion.ok) {
    return schemaVersion;
  }

  if (json.license !== 'CC0-1.0') {
    return fail('invalid-license', 'license must be CC0-1.0');
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

  const baseV10 = {
    schemaVersion: '1.0' as const,
    provenance: provenance.value,
    license: 'CC0-1.0' as const,
    contributor: contributor.value,
    signature: signature.value,
    ...(evidence.value !== undefined ? { evidence: evidence.value } : {}),
    ...(supersedes !== undefined ? { supersedes } : {}),
  };

  const baseV11 = {
    schemaVersion: '1.1' as const,
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
        value: { ...baseV10, type: 'wmi', key: key.value, value: value.value } satisfies WmiClaim,
      };
    }
    case 'vds-schema': {
      const key = parseVdsSchemaKey(json.key);
      if (!key.ok) {
        return key;
      }
      const value = parseEmptyObject(json.value, 'value');
      if (!value.ok) {
        return value;
      }
      return {
        ok: true,
        value: {
          ...baseV11,
          type: 'vds-schema',
          key: key.value,
          value: value.value,
        } satisfies VdsSchemaClaim,
      };
    }
    case 'vds-binding': {
      const key = parseVdsBindingKey(json.key);
      if (!key.ok) {
        return key;
      }
      const value = parseEmptyObject(json.value, 'value');
      if (!value.ok) {
        return value;
      }
      return {
        ok: true,
        value: {
          ...baseV11,
          type: 'vds-binding',
          key: key.value,
          value: value.value,
        } satisfies VdsBindingClaim,
      };
    }
    case 'vds-pattern': {
      const key = parseVdsPatternKey(json.key);
      if (!key.ok) {
        return key;
      }
      const value = parseVdsPatternValue(json.value);
      if (!value.ok) {
        return value;
      }
      return {
        ok: true,
        value: {
          ...baseV11,
          type: 'vds-pattern',
          key: key.value,
          value: value.value,
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
          ...baseV10,
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
