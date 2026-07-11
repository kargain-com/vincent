import type { DecodeLeaf, LeafBinding, PartitionEntry, PartitionManifest, WireLeaf } from './leaf-types.js';

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function bytesToString(bytes: Uint8Array): string {
  return new TextDecoder().decode(bytes);
}

function rejectUnknownKeys(
  obj: Record<string, unknown>,
  allowed: Set<string>,
  field: string,
): { ok: true } | { ok: false; reason: string } {
  for (const key of Object.keys(obj)) {
    if (!allowed.has(key)) {
      return { ok: false, reason: `Unknown key in ${field}: ${key}` };
    }
  }
  return { ok: true };
}

const BINDING_KEYS = new Set(['yearFrom', 'yearTo', 'schemaRef']);
const PATTERN_KEYS = new Set(['match', 'attribute', 'code']);
const MATCH_KEYS = new Set(['vds', 'vis']);
const SCHEMA_KEYS = new Set(['patterns']);
const LEAF_KEYS = new Set(['wmi', 'bindings', 'schemas']);
const PARTITION_ENTRY_KEYS = new Set(['yearFrom', 'yearTo', 'key', 'leafHash']);
const MANIFEST_KEYS = new Set(['wmi', 'partitioned', 'partitions']);

function parseMatch(value: unknown): { ok: true; value: { vds: string; vis?: string } } | { ok: false } {
  if (!isPlainObject(value) || typeof value.vds !== 'string') {
    return { ok: false };
  }
  const keys = rejectUnknownKeys(value, MATCH_KEYS, 'leaf pattern match');
  if (!keys.ok) {
    return { ok: false };
  }
  if ('vis' in value && value.vis !== undefined && typeof value.vis !== 'string') {
    return { ok: false };
  }
  return {
    ok: true,
    value: {
      vds: value.vds,
      ...(typeof value.vis === 'string' ? { vis: value.vis } : {}),
    },
  };
}

function parseBinding(value: unknown): { ok: true; value: LeafBinding } | { ok: false; reason: string } {
  if (!isPlainObject(value)) {
    return { ok: false, reason: 'invalid leaf binding' };
  }
  const keys = rejectUnknownKeys(value, BINDING_KEYS, 'leaf binding');
  if (!keys.ok) {
    return keys;
  }
  if (
    typeof value.yearFrom !== 'number' ||
    !Number.isInteger(value.yearFrom) ||
    !('schemaRef' in value) ||
    typeof value.schemaRef !== 'string' ||
    !('yearTo' in value)
  ) {
    return { ok: false, reason: 'invalid leaf binding' };
  }
  const yearTo = value.yearTo;
  if (yearTo !== null && (typeof yearTo !== 'number' || !Number.isInteger(yearTo))) {
    return { ok: false, reason: 'invalid leaf binding' };
  }
  return {
    ok: true,
    value: {
      yearFrom: value.yearFrom,
      yearTo,
      schemaRef: value.schemaRef,
    },
  };
}

function parsePattern(
  value: unknown,
): { ok: true; value: DecodeLeaf['schemas'][string]['patterns'][number] } | { ok: false } {
  if (!isPlainObject(value)) {
    return { ok: false };
  }
  const keys = rejectUnknownKeys(value, PATTERN_KEYS, 'leaf pattern');
  if (!keys.ok) {
    return { ok: false };
  }
  if (typeof value.attribute !== 'string' || typeof value.code !== 'string') {
    return { ok: false };
  }
  const match = parseMatch(value.match);
  if (!match.ok) {
    return { ok: false };
  }
  return {
    ok: true,
    value: {
      match: match.value,
      attribute: value.attribute,
      code: value.code,
    },
  };
}

/** Parse a self-contained leaf JSON document (fail-closed). */
export function parseLeaf(json: unknown): { ok: true; value: DecodeLeaf } | { ok: false; reason: string } {
  if (!isPlainObject(json)) {
    return { ok: false, reason: 'leaf must be a JSON object' };
  }
  if (json.partitioned === true) {
    return { ok: false, reason: 'leaf must not be a partition manifest' };
  }
  if ('partitioned' in json) {
    return { ok: false, reason: 'leaf must not contain partitioned' };
  }
  const topKeys = rejectUnknownKeys(json, LEAF_KEYS, 'leaf');
  if (!topKeys.ok) {
    return topKeys;
  }
  if (typeof json.wmi !== 'string') {
    return { ok: false, reason: 'leaf.wmi must be a string' };
  }
  if (!Array.isArray(json.bindings)) {
    return { ok: false, reason: 'leaf.bindings must be an array' };
  }
  if (!isPlainObject(json.schemas)) {
    return { ok: false, reason: 'leaf.schemas must be an object' };
  }

  const bindings: DecodeLeaf['bindings'] = [];
  for (const item of json.bindings) {
    const parsed = parseBinding(item);
    if (!parsed.ok) {
      return { ok: false, reason: parsed.reason };
    }
    bindings.push(parsed.value);
  }

  const schemas: DecodeLeaf['schemas'] = {};
  for (const [key, schemaValue] of Object.entries(json.schemas)) {
    if (!isPlainObject(schemaValue) || !Array.isArray(schemaValue.patterns)) {
      return { ok: false, reason: 'invalid leaf schema' };
    }
    const schemaKeys = rejectUnknownKeys(schemaValue, SCHEMA_KEYS, 'leaf schema');
    if (!schemaKeys.ok) {
      return schemaKeys;
    }
    const patterns: DecodeLeaf['schemas'][string]['patterns'] = [];
    for (const pattern of schemaValue.patterns) {
      const parsed = parsePattern(pattern);
      if (!parsed.ok) {
        return { ok: false, reason: 'invalid leaf pattern' };
      }
      patterns.push(parsed.value);
    }
    schemas[key] = { patterns };
  }

  return { ok: true, value: { wmi: json.wmi, bindings, schemas } };
}

/** Parse leaf bytes. */
export function parseLeafBytes(content: Uint8Array | string): ReturnType<typeof parseLeaf> {
  const text = typeof content === 'string' ? content : bytesToString(content);
  try {
    return parseLeaf(JSON.parse(text) as unknown);
  } catch {
    return { ok: false, reason: 'leaf is not valid JSON' };
  }
}

function parsePartitionEntry(
  value: unknown,
): { ok: true; value: PartitionEntry } | { ok: false; reason: string } {
  if (!isPlainObject(value)) {
    return { ok: false, reason: 'invalid partition entry' };
  }
  const keys = rejectUnknownKeys(value, PARTITION_ENTRY_KEYS, 'partition entry');
  if (!keys.ok) {
    return keys;
  }
  if (
    typeof value.yearFrom !== 'number' ||
    !Number.isInteger(value.yearFrom) ||
    typeof value.key !== 'string' ||
    typeof value.leafHash !== 'string' ||
    !('yearTo' in value)
  ) {
    return { ok: false, reason: 'invalid partition entry' };
  }
  const yearTo = value.yearTo;
  if (yearTo !== null && (typeof yearTo !== 'number' || !Number.isInteger(yearTo))) {
    return { ok: false, reason: 'invalid partition entry' };
  }
  return {
    ok: true,
    value: {
      yearFrom: value.yearFrom,
      yearTo,
      key: value.key,
      leafHash: value.leafHash,
    },
  };
}

/** Type guard for partition manifests. */
export function isPartitionManifest(leaf: WireLeaf): leaf is PartitionManifest {
  return 'partitioned' in leaf && leaf.partitioned === true;
}

/** Parse a Merkle leaf as either a decode leaf or a partition manifest. */
export function parseWireLeaf(
  json: unknown,
): { ok: true; value: WireLeaf } | { ok: false; reason: string } {
  if (!isPlainObject(json)) {
    return { ok: false, reason: 'leaf must be a JSON object' };
  }
  if (json.partitioned === true) {
    const keys = rejectUnknownKeys(json, MANIFEST_KEYS, 'partition manifest');
    if (!keys.ok) {
      return keys;
    }
    if (typeof json.wmi !== 'string') {
      return { ok: false, reason: 'manifest.wmi must be a string' };
    }
    if (!Array.isArray(json.partitions)) {
      return { ok: false, reason: 'manifest.partitions must be an array' };
    }
    const partitions: PartitionEntry[] = [];
    for (const item of json.partitions) {
      const parsed = parsePartitionEntry(item);
      if (!parsed.ok) {
        return { ok: false, reason: parsed.reason };
      }
      partitions.push(parsed.value);
    }
    return {
      ok: true,
      value: {
        wmi: json.wmi,
        partitioned: true,
        partitions,
      },
    };
  }
  if ('partitioned' in json) {
    return { ok: false, reason: 'leaf partitioned must be true when present' };
  }
  const leaf = parseLeaf(json);
  if (!leaf.ok) {
    return leaf;
  }
  return { ok: true, value: leaf.value };
}
