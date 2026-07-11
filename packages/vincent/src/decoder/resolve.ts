import { decodeModelYear } from '../model-year.js';
import { validateVin } from '../validation.js';
import type { BindingRow, DatasetDb, WmiRow } from './dataset-db.js';
import { matchExpression } from './match.js';
import type {
  AttributeCandidate,
  DecodeOptions,
  DecodedAttribute,
  DecodeResult,
  DecodedWmi,
} from './types.js';

/** Pattern match hit before attribute merge. */
export interface PatternHit {
  attribute: string;
  code: string;
  schemaHash: string;
  claimHash: string;
}

interface TaggedHit {
  hit: PatternHit;
  year: number;
}

/**
 * Resolve WMI lookup key: 3-char, or 6-char when position 3 is "9" (§4.4).
 * Future: converge with bundled `./wmi` lookup for pre-decode hints; decoder
 * remains self-contained over epoch data.
 */
export function resolveWmiKey(vin: string): string {
  if (vin.length >= 6 && vin.charAt(2) === '9') {
    return vin.slice(0, 6);
  }
  return vin.slice(0, 3);
}

function toDecodedWmi(row: WmiRow): DecodedWmi {
  return {
    wmi: row.wmi,
    manufacturer: row.manufacturer,
    country: row.country,
    region: row.region,
    sourceClaimHash: row.claimHash,
  };
}

function bindingContainsYear(binding: BindingRow, year: number): boolean {
  if (year < binding.yearFrom) {
    return false;
  }
  if (binding.yearTo !== null && year > binding.yearTo) {
    return false;
  }
  return true;
}

function collectHitsForBindings(
  db: DatasetDb,
  vin: string,
  bindings: readonly BindingRow[],
): PatternHit[] {
  const hits: PatternHit[] = [];
  const seenSchemas = new Set<string>();

  for (const binding of bindings) {
    if (seenSchemas.has(binding.schemaHash)) {
      continue;
    }
    seenSchemas.add(binding.schemaHash);

    const patterns = db.getPatterns(binding.schemaHash);
    for (const pattern of patterns) {
      if (
        matchExpression(
          { vds: pattern.matchVds, vis: pattern.matchVis ?? undefined },
          vin,
        )
      ) {
        hits.push({
          attribute: pattern.attribute,
          code: pattern.code,
          schemaHash: pattern.schemaHash,
          claimHash: pattern.claimHash,
        });
      }
    }
  }

  return hits;
}

function collectPatternHits(db: DatasetDb, wmi: string, vin: string, year: number): PatternHit[] {
  const bindings = db.getBindings(wmi, year);
  return collectHitsForBindings(db, vin, bindings);
}

function toCandidate(hit: PatternHit): AttributeCandidate {
  return {
    value: hit.code,
    schema: hit.schemaHash,
    sourceClaimHash: hit.claimHash,
  };
}

function distinctCandidates(hits: readonly PatternHit[]): AttributeCandidate[] {
  const seen = new Set<string>();
  const candidates: AttributeCandidate[] = [];

  for (const hit of hits) {
    const key = `${hit.code}\0${hit.schemaHash}\0${hit.claimHash}`;
    if (seen.has(key)) {
      continue;
    }
    seen.add(key);
    candidates.push(toCandidate(hit));
  }

  return candidates;
}

function mergeHits(hits: readonly PatternHit[]): DecodedAttribute[] {
  const byAttribute = new Map<string, PatternHit[]>();

  for (const hit of hits) {
    const group = byAttribute.get(hit.attribute);
    if (group === undefined) {
      byAttribute.set(hit.attribute, [hit]);
    } else {
      group.push(hit);
    }
  }

  const attributes: DecodedAttribute[] = [];

  for (const [attribute, group] of byAttribute) {
    const candidates = distinctCandidates(group);
    const distinctValues = new Set(group.map((hit) => hit.code));

    if (distinctValues.size === 1) {
      const hit = group[0];
      attributes.push({
        attribute,
        value: hit.code,
        ambiguous: false,
        schema: hit.schemaHash,
        sourceClaimHash: hit.claimHash,
      });
      continue;
    }

    attributes.push({
      attribute,
      value: null,
      ambiguous: true,
      candidates,
      schema: null,
      sourceClaimHash: null,
    });
  }

  attributes.sort((left, right) => left.attribute.localeCompare(right.attribute));
  return attributes;
}

function mergeTaggedHits(tagged: readonly TaggedHit[], candidateYears: readonly number[]): DecodedAttribute[] {
  const byAttribute = new Map<string, TaggedHit[]>();

  for (const entry of tagged) {
    const group = byAttribute.get(entry.hit.attribute);
    if (group === undefined) {
      byAttribute.set(entry.hit.attribute, [entry]);
    } else {
      group.push(entry);
    }
  }

  const attributes: DecodedAttribute[] = [];

  for (const [attribute, group] of byAttribute) {
    const candidates = distinctCandidates(group.map((entry) => entry.hit));
    const distinctValues = new Set(group.map((entry) => entry.hit.code));

    if (distinctValues.size === 1) {
      const hit = group[0].hit;
      attributes.push({
        attribute,
        value: hit.code,
        ambiguous: false,
        schema: hit.schemaHash,
        sourceClaimHash: hit.claimHash,
      });
      continue;
    }

    let ambiguous = false;
    for (const year of candidateYears) {
      const codesForYear = new Set(
        group.filter((entry) => entry.year === year).map((entry) => entry.hit.code),
      );
      if (codesForYear.size > 1) {
        ambiguous = true;
        break;
      }
    }

    if (ambiguous) {
      attributes.push({
        attribute,
        value: null,
        ambiguous: true,
        candidates,
        schema: null,
        sourceClaimHash: null,
      });
      continue;
    }

    attributes.push({
      attribute,
      value: null,
      ambiguous: false,
      yearDependent: true,
      candidates,
      schema: null,
      sourceClaimHash: null,
    });
  }

  attributes.sort((left, right) => left.attribute.localeCompare(right.attribute));
  return attributes;
}

function collectTaggedHits(
  db: DatasetDb,
  wmi: string,
  vin: string,
  candidateYears: readonly number[],
): TaggedHit[] {
  const tagged: TaggedHit[] = [];

  for (const year of candidateYears) {
    const hits = collectPatternHits(db, wmi, vin, year);
    for (const hit of hits) {
      tagged.push({ hit, year });
    }
  }

  return tagged;
}

/** Decode a VIN against an open epoch dataset (pure over db reads). */
export function decodeFromDataset(db: DatasetDb, vin: string, options?: DecodeOptions): DecodeResult {
  const validation = validateVin(vin);
  const modelYear = decodeModelYear(validation.normalized);
  const resolvedYear = options?.year ?? modelYear.best ?? null;
  const yearAmbiguous = options?.year === undefined && modelYear.best === null;

  const base: DecodeResult = {
    vin: validation.normalized,
    valid: validation.ok,
    year: {
      value: resolvedYear,
      ambiguous: yearAmbiguous,
      candidates: modelYear.candidates,
    },
    wmi: null,
    attributes: [],
    errors: validation.errors,
    warnings: validation.warnings,
  };

  if (!validation.ok || validation.normalized.length < 3) {
    return base;
  }

  const wmiKey = resolveWmiKey(validation.normalized);
  const wmiRow = db.getWmi(wmiKey);
  if (wmiRow === null) {
    return base;
  }

  base.wmi = toDecodedWmi(wmiRow);

  if (yearAmbiguous) {
    if (modelYear.candidates.length === 0) {
      return base;
    }
    const tagged = collectTaggedHits(db, wmiKey, validation.normalized, modelYear.candidates);
    base.attributes = mergeTaggedHits(tagged, modelYear.candidates);
    return base;
  }

  const hits = collectPatternHits(db, wmiKey, validation.normalized, resolvedYear!);
  base.attributes = mergeHits(hits);
  return base;
}

export {
  bindingContainsYear,
  collectHitsForBindings,
  collectPatternHits,
  collectTaggedHits,
  mergeHits,
  mergeTaggedHits,
};
