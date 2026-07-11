import { canonicalize } from '@kargain/vincent/protocol';
import type { Claim } from '@kargain/vincent/protocol';

import { contentSha256 } from './hash-content.js';

/** Maximum canonical leaf size (128 KiB). */
export const LEAF_CAP_BYTES = 128 * 1024;

const PROGRESS_INTERVAL = 500;

export interface LeafPattern {
  match: { vds: string; vis?: string };
  attribute: string;
  code: string;
}

export interface LeafBinding {
  yearFrom: number;
  yearTo: number | null;
  schemaRef: string;
}

export interface LeafDoc {
  wmi: string;
  bindings: LeafBinding[];
  schemas: Record<string, { patterns: LeafPattern[] }>;
}

export interface PartitionManifestEntry {
  yearFrom: number;
  yearTo: number | null;
  key: string;
  leafHash: string;
}

export interface PartitionManifestDoc {
  wmi: string;
  partitioned: true;
  partitions: PartitionManifestEntry[];
}

interface ClaimIndex {
  bindingsByWmi: Map<string, LeafBinding[]>;
  patternsBySchema: Map<string, LeafPattern[]>;
  wmiKeys: Set<string>;
}

interface SchemaBlockCache {
  /** Byte length of canonical `{ patterns }` for each schemaRef. */
  patternBlockBytes: Map<string, number>;
  /** Byte length of canonical `{ [schemaRef]: { patterns } }` for each schemaRef. */
  schemaEntryBytes: Map<string, number>;
}

export interface BoundarySegment {
  yearFrom: number;
  yearTo: number | null;
}

interface SegmentMeta extends BoundarySegment {
  schemaRefs: string[];
  bindingBytes: number;
}

export interface BuildLeavesOptions {
  leafCapBytes?: number;
  progress?: (message: string) => void;
}

function compareStrings(a: string, b: string): number {
  if (a < b) {
    return -1;
  }
  if (a > b) {
    return 1;
  }
  return 0;
}

function compareYearTo(a: number | null, b: number | null): number {
  if (a === null && b === null) {
    return 0;
  }
  if (a === null) {
    return 1;
  }
  if (b === null) {
    return -1;
  }
  return a - b;
}

function compareBindings(a: LeafBinding, b: LeafBinding): number {
  let cmp = a.yearFrom - b.yearFrom;
  if (cmp !== 0) {
    return cmp;
  }
  cmp = compareYearTo(a.yearTo, b.yearTo);
  if (cmp !== 0) {
    return cmp;
  }
  return compareStrings(a.schemaRef, b.schemaRef);
}

function comparePatterns(a: LeafPattern, b: LeafPattern): number {
  let cmp = compareStrings(a.match.vds, b.match.vds);
  if (cmp !== 0) {
    return cmp;
  }
  cmp = compareStrings(a.match.vis ?? '', b.match.vis ?? '');
  if (cmp !== 0) {
    return cmp;
  }
  cmp = compareStrings(a.attribute, b.attribute);
  if (cmp !== 0) {
    return cmp;
  }
  return compareStrings(a.code, b.code);
}

function comparePartitions(a: PartitionManifestEntry, b: PartitionManifestEntry): number {
  let cmp = a.yearFrom - b.yearFrom;
  if (cmp !== 0) {
    return cmp;
  }
  cmp = compareYearTo(a.yearTo, b.yearTo);
  if (cmp !== 0) {
    return cmp;
  }
  return compareStrings(a.key, b.key);
}

function indexClaims(claims: readonly Claim[]): ClaimIndex {
  const bindingsByWmi = new Map<string, LeafBinding[]>();
  const patternsBySchema = new Map<string, LeafPattern[]>();
  const wmiKeys = new Set<string>();

  for (const claim of claims) {
    switch (claim.type) {
      case 'wmi':
      case 'year-hint':
        wmiKeys.add(claim.key.wmi);
        break;
      case 'vds-binding': {
        wmiKeys.add(claim.key.wmi);
        const bindings = bindingsByWmi.get(claim.key.wmi) ?? [];
        bindings.push({
          yearFrom: claim.key.yearFrom,
          yearTo: claim.key.yearTo,
          schemaRef: claim.key.schema,
        });
        bindingsByWmi.set(claim.key.wmi, bindings);
        break;
      }
      case 'vds-pattern': {
        const patterns = patternsBySchema.get(claim.key.schema) ?? [];
        patterns.push({
          match: {
            vds: claim.key.match.vds,
            ...(claim.key.match.vis !== undefined ? { vis: claim.key.match.vis } : {}),
          },
          attribute: claim.value.attribute,
          code: claim.value.code,
        });
        patternsBySchema.set(claim.key.schema, patterns);
        break;
      }
      default:
        break;
    }
  }

  return { bindingsByWmi, patternsBySchema, wmiKeys };
}

function buildSchemaBlockCache(index: ClaimIndex): SchemaBlockCache {
  const patternBlockBytes = new Map<string, number>();
  const schemaEntryBytes = new Map<string, number>();

  for (const [schemaRef, patterns] of index.patternsBySchema) {
    const sorted = [...patterns].sort(comparePatterns);
    const block = canonicalize({ patterns: sorted });
    patternBlockBytes.set(schemaRef, Buffer.byteLength(block, 'utf8'));
    schemaEntryBytes.set(
      schemaRef,
      Buffer.byteLength(canonicalize({ [schemaRef]: { patterns: sorted } }), 'utf8'),
    );
  }

  return { patternBlockBytes, schemaEntryBytes };
}

function bindingOverlapsRange(
  binding: LeafBinding,
  rangeStart: number,
  rangeEnd: number | null,
): boolean {
  if (binding.yearTo !== null && binding.yearTo < rangeStart) {
    return false;
  }
  if (rangeEnd !== null && binding.yearFrom > rangeEnd) {
    return false;
  }
  return true;
}

function clipBinding(
  binding: LeafBinding,
  rangeStart: number,
  rangeEnd: number | null,
): LeafBinding {
  const yearFrom = Math.max(binding.yearFrom, rangeStart);
  let yearTo: number | null;
  if (rangeEnd === null) {
    yearTo = binding.yearTo;
  } else if (binding.yearTo === null) {
    yearTo = rangeEnd;
  } else {
    yearTo = Math.min(binding.yearTo, rangeEnd);
  }
  return { yearFrom, yearTo, schemaRef: binding.schemaRef };
}

function clipBindingsForRange(
  bindings: readonly LeafBinding[],
  rangeStart: number,
  rangeEnd: number | null,
): LeafBinding[] {
  const clipped: LeafBinding[] = [];
  for (const binding of bindings) {
    if (bindingOverlapsRange(binding, rangeStart, rangeEnd)) {
      clipped.push(clipBinding(binding, rangeStart, rangeEnd));
    }
  }
  clipped.sort(compareBindings);
  return clipped;
}

function bindingArrayBytes(bindings: readonly LeafBinding[]): number {
  if (bindings.length === 0) {
    return Buffer.byteLength('[]', 'utf8');
  }
  return Buffer.byteLength(canonicalize(bindings), 'utf8');
}

function schemaRefsForRange(
  bindings: readonly LeafBinding[],
  rangeStart: number,
  rangeEnd: number | null,
): string[] {
  const refs = new Set<string>();
  for (const binding of bindings) {
    if (bindingOverlapsRange(binding, rangeStart, rangeEnd)) {
      refs.add(binding.schemaRef);
    }
  }
  return [...refs].sort(compareStrings);
}

function buildSchemasForBindings(
  bindings: readonly LeafBinding[],
  index: ClaimIndex,
): LeafDoc['schemas'] {
  const schemaRefs = new Set<string>();
  for (const binding of bindings) {
    schemaRefs.add(binding.schemaRef);
  }

  const schemas: LeafDoc['schemas'] = {};
  for (const schemaRef of [...schemaRefs].sort(compareStrings)) {
    const patterns = [...(index.patternsBySchema.get(schemaRef) ?? [])];
    patterns.sort(comparePatterns);
    schemas[schemaRef] = { patterns };
  }
  return schemas;
}

function buildLeafDoc(wmi: string, index: ClaimIndex): LeafDoc {
  const bindings = [...(index.bindingsByWmi.get(wmi) ?? [])];
  bindings.sort(compareBindings);
  const schemas = buildSchemasForBindings(bindings, index);
  return { wmi, bindings, schemas };
}

function buildLeafDocForRange(
  wmi: string,
  index: ClaimIndex,
  rangeStart: number,
  rangeEnd: number | null,
): LeafDoc {
  const rawBindings = index.bindingsByWmi.get(wmi) ?? [];
  const clipped = clipBindingsForRange(rawBindings, rangeStart, rangeEnd);
  const schemas = buildSchemasForBindings(clipped, index);
  return { wmi, bindings: clipped, schemas };
}

function canonicalSize(doc: LeafDoc | PartitionManifestDoc): number {
  return Buffer.byteLength(canonicalize(doc), 'utf8');
}

function segmentHasBindings(
  bindings: readonly LeafBinding[],
  yearFrom: number,
  yearTo: number | null,
): boolean {
  for (const binding of bindings) {
    if (bindingOverlapsRange(binding, yearFrom, yearTo)) {
      return true;
    }
  }
  return false;
}

/** Collect year-range segments at binding boundaries (no per-year enumeration). */
function collectBoundarySegments(bindings: readonly LeafBinding[]): BoundarySegment[] {
  if (bindings.length === 0) {
    return [];
  }

  const boundaries = new Set<number>();
  let hasOpenEnded = false;

  for (const binding of bindings) {
    boundaries.add(binding.yearFrom);
    if (binding.yearTo === null) {
      hasOpenEnded = true;
    } else {
      boundaries.add(binding.yearTo + 1);
    }
  }

  const sorted = [...boundaries].sort((a, b) => a - b);
  const segments: BoundarySegment[] = [];

  for (let index = 0; index < sorted.length - 1; index++) {
    const yearFrom = sorted[index];
    const yearTo = sorted[index + 1] - 1;
    if (segmentHasBindings(bindings, yearFrom, yearTo)) {
      segments.push({ yearFrom, yearTo });
    }
  }

  const lastBoundary = sorted[sorted.length - 1];
  if (hasOpenEnded && segmentHasBindings(bindings, lastBoundary, null)) {
    segments.push({ yearFrom: lastBoundary, yearTo: null });
  }

  return segments;
}

function wmiShellBytes(wmi: string): number {
  return Buffer.byteLength(canonicalize({ wmi, bindings: [], schemas: {} }), 'utf8');
}

function schemasPayloadBytes(schemaRefs: readonly string[], cache: SchemaBlockCache): number {
  if (schemaRefs.length === 0) {
    return Buffer.byteLength('{}', 'utf8');
  }
  let total = 0;
  for (let index = 0; index < schemaRefs.length; index++) {
    if (index > 0) {
      total += 1;
    }
    total += cache.schemaEntryBytes.get(schemaRefs[index]) ?? 0;
  }
  return total;
}

function estimateRangeBytes(
  wmi: string,
  bindings: readonly LeafBinding[],
  rangeStart: number,
  rangeEnd: number | null,
  cache: SchemaBlockCache,
): number {
  const clipped = clipBindingsForRange(bindings, rangeStart, rangeEnd);
  const schemaRefs = schemaRefsForRange(bindings, rangeStart, rangeEnd);
  return (
    wmiShellBytes(wmi) +
    bindingArrayBytes(clipped) +
    schemasPayloadBytes(schemaRefs, cache) +
    12
  );
}

function buildSegmentMeta(
  wmi: string,
  bindings: readonly LeafBinding[],
  segments: readonly BoundarySegment[],
): SegmentMeta[] {
  return segments.map((segment) => {
    const clipped = clipBindingsForRange(bindings, segment.yearFrom, segment.yearTo);
    return {
      yearFrom: segment.yearFrom,
      yearTo: segment.yearTo,
      schemaRefs: schemaRefsForRange(bindings, segment.yearFrom, segment.yearTo),
      bindingBytes: bindingArrayBytes(clipped),
    };
  });
}

function emitLeafEntry(
  doc: LeafDoc | PartitionManifestDoc,
): { canonical: string; leafHash: string } {
  const canonical = canonicalize(doc);
  return { canonical, leafHash: contentSha256(canonical) };
}

interface PatternRef {
  schemaRef: string;
  pattern: LeafPattern;
}

function buildLeafDocFromPatterns(
  wmi: string,
  bindings: readonly LeafBinding[],
  patternRefs: readonly PatternRef[],
): LeafDoc {
  const schemas: LeafDoc['schemas'] = {};
  for (const ref of patternRefs) {
    const existing = schemas[ref.schemaRef]?.patterns ?? [];
    schemas[ref.schemaRef] = { patterns: [...existing, ref.pattern] };
  }
  for (const schemaRef of Object.keys(schemas)) {
    schemas[schemaRef].patterns.sort(comparePatterns);
  }
  const sortedBindings = [...bindings].sort(compareBindings);
  return { wmi, bindings: sortedBindings, schemas };
}

function collectPatternRefs(doc: LeafDoc): PatternRef[] {
  const refs: PatternRef[] = [];
  for (const [schemaRef, schema] of Object.entries(doc.schemas)) {
    for (const pattern of schema.patterns) {
      refs.push({ schemaRef, pattern });
    }
  }
  refs.sort((a, b) => {
    const cmp = compareStrings(a.schemaRef, b.schemaRef);
    if (cmp !== 0) {
      return cmp;
    }
    return comparePatterns(a.pattern, b.pattern);
  });
  return refs;
}

function emitPatternSplitSubLeaves(
  wmi: string,
  bindings: readonly LeafBinding[],
  patternRefs: readonly PatternRef[],
  yearFrom: number,
  yearTo: number | null,
  cap: number,
  partIndex: number,
  partitions: PartitionManifestEntry[],
  result: Map<string, { canonical: string; leafHash: string }>,
): number {
  let chunk: PatternRef[] = [];
  for (const ref of patternRefs) {
    const trial = buildLeafDocFromPatterns(wmi, bindings, [...chunk, ref]);
    if (canonicalSize(trial) > cap) {
      if (chunk.length === 0) {
        throw new Error(`single pattern exceeds leaf cap for WMI ${wmi}`);
      }
      const doc = buildLeafDocFromPatterns(wmi, bindings, chunk);
      const entry = emitLeafEntry(doc);
      const key = `${wmi}#p${String(partIndex)}`;
      result.set(key, entry);
      partitions.push({
        yearFrom,
        yearTo,
        key,
        leafHash: entry.leafHash,
      });
      partIndex += 1;
      chunk = [ref];
      if (canonicalSize(buildLeafDocFromPatterns(wmi, bindings, chunk)) > cap) {
        throw new Error(`single pattern exceeds leaf cap for WMI ${wmi}`);
      }
    } else {
      chunk.push(ref);
    }
  }

  if (chunk.length > 0) {
    const doc = buildLeafDocFromPatterns(wmi, bindings, chunk);
    const entry = emitLeafEntry(doc);
    const key = `${wmi}#p${String(partIndex)}`;
    result.set(key, entry);
    partitions.push({
      yearFrom,
      yearTo,
      key,
      leafHash: entry.leafHash,
    });
    partIndex += 1;
  }

  return partIndex;
}

function emitSubLeafRange(
  wmi: string,
  index: ClaimIndex,
  rangeStart: number,
  rangeEnd: number | null,
  cap: number,
  partIndex: number,
  partitions: PartitionManifestEntry[],
  result: Map<string, { canonical: string; leafHash: string }>,
): number {
  const doc = buildLeafDocForRange(wmi, index, rangeStart, rangeEnd);
  if (canonicalSize(doc) <= cap) {
    const entry = emitLeafEntry(doc);
    const key = `${wmi}#p${String(partIndex)}`;
    result.set(key, entry);
    partitions.push({
      yearFrom: rangeStart,
      yearTo: rangeEnd,
      key,
      leafHash: entry.leafHash,
    });
    return partIndex + 1;
  }
  return emitPatternSplitSubLeaves(
    wmi,
    doc.bindings,
    collectPatternRefs(doc),
    rangeStart,
    rangeEnd,
    cap,
    partIndex,
    partitions,
    result,
  );
}

function partitionWmi(
  wmi: string,
  index: ClaimIndex,
  cache: SchemaBlockCache,
  cap: number,
): Map<string, { canonical: string; leafHash: string }> {
  const bindings = index.bindingsByWmi.get(wmi) ?? [];
  const result = new Map<string, { canonical: string; leafHash: string }>();

  const fullDoc = buildLeafDoc(wmi, index);
  if (canonicalSize(fullDoc) <= cap) {
    result.set(wmi, emitLeafEntry(fullDoc));
    return result;
  }

  const segments = collectBoundarySegments(bindings);
  if (segments.length === 0) {
    result.set(wmi, emitLeafEntry(fullDoc));
    return result;
  }

  const segmentMeta = buildSegmentMeta(wmi, bindings, segments);
  const packThreshold = Math.floor(cap * 0.95);
  const partitions: PartitionManifestEntry[] = [];
  let partIndex = 0;

  let packStart = 0;
  while (packStart < segmentMeta.length) {
    let packEnd = packStart;
    while (packEnd + 1 < segmentMeta.length) {
      const trialEstimate = estimateRangeBytes(
        wmi,
        bindings,
        segmentMeta[packStart].yearFrom,
        segmentMeta[packEnd + 1].yearTo,
        cache,
      );
      if (trialEstimate > packThreshold) {
        break;
      }
      packEnd += 1;
    }
    partIndex = emitSubLeafRange(
      wmi,
      index,
      segmentMeta[packStart].yearFrom,
      segmentMeta[packEnd].yearTo,
      cap,
      partIndex,
      partitions,
      result,
    );
    packStart = packEnd + 1;
  }

  partitions.sort(comparePartitions);
  const manifest: PartitionManifestDoc = {
    wmi,
    partitioned: true,
    partitions,
  };
  result.set(wmi, emitLeafEntry(manifest));
  return result;
}

export interface BuildLeavesResult {
  leaves: Map<string, { canonical: string; leafHash: string }>;
}

/** Build deterministic self-contained per-WMI leaves from sorted claims. */
export function buildLeaves(
  claims: readonly Claim[],
  options: BuildLeavesOptions = {},
): BuildLeavesResult {
  const cap = options.leafCapBytes ?? LEAF_CAP_BYTES;
  const index = indexClaims(claims);
  const cache = buildSchemaBlockCache(index);
  const leaves = new Map<string, { canonical: string; leafHash: string }>();
  const wmiKeys = [...index.wmiKeys].sort(compareStrings);
  let partitionedWmiCount = 0;

  for (let wmiIndex = 0; wmiIndex < wmiKeys.length; wmiIndex++) {
    const wmi = wmiKeys[wmiIndex];
    const entries = partitionWmi(wmi, index, cache, cap);
    const manifestEntry = entries.get(wmi);
    if (manifestEntry !== undefined) {
      try {
        const parsed = JSON.parse(manifestEntry.canonical) as { partitioned?: boolean };
        if (parsed.partitioned === true) {
          partitionedWmiCount += 1;
        }
      } catch {
        // ignore
      }
    }
    for (const [leafKey, entry] of entries) {
      leaves.set(leafKey, entry);
    }

    const processed = wmiIndex + 1;
    if (
      options.progress !== undefined &&
      (processed % PROGRESS_INTERVAL === 0 || processed === wmiKeys.length)
    ) {
      options.progress(
        `Building leaves: ${String(processed)}/${String(wmiKeys.length)} WMIs (${String(partitionedWmiCount)} partitioned)`,
      );
    }
  }

  return { leaves };
}

export { buildLeafDoc, buildLeafDocForRange, collectBoundarySegments, compareStrings };
