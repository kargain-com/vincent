import { decodeModelYear } from '../model-year.js';
import { validateVin } from '../validation.js';
import { matchExpression } from './match.js';
import type { DecodeLeaf, LeafBinding } from './leaf-types.js';
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
  schemaRef: string;
}

interface TaggedHit {
  hit: PatternHit;
  year: number;
}

/**
 * Resolve WMI lookup key: 3-char, or 6-char when position 3 is "9" (§4.4).
 */
export function resolveWmiKey(vin: string): string {
  if (vin.length >= 6 && vin.charAt(2) === '9') {
    return vin.slice(0, 6);
  }
  return vin.slice(0, 3);
}

function toDecodedWmi(wmi: DecodedWmi): DecodedWmi {
  return wmi;
}

function bindingContainsYear(binding: LeafBinding, year: number): boolean {
  if (year < binding.yearFrom) {
    return false;
  }
  if (binding.yearTo !== null && year > binding.yearTo) {
    return false;
  }
  return true;
}

function getBindingsForYear(leaf: DecodeLeaf, year: number): LeafBinding[] {
  return leaf.bindings.filter((binding) => bindingContainsYear(binding, year));
}

function collectHitsForBindings(
  leaf: DecodeLeaf,
  vin: string,
  bindings: readonly LeafBinding[],
): PatternHit[] {
  const hits: PatternHit[] = [];
  const seenSchemas = new Set<string>();

  for (const binding of bindings) {
    if (seenSchemas.has(binding.schemaRef)) {
      continue;
    }
    seenSchemas.add(binding.schemaRef);

    const schema = leaf.schemas[binding.schemaRef];
    if (schema === undefined) {
      continue;
    }

    for (const pattern of schema.patterns) {
      if (
        matchExpression(
          { vds: pattern.match.vds, vis: pattern.match.vis ?? undefined },
          vin,
        )
      ) {
        hits.push({
          attribute: pattern.attribute,
          code: pattern.code,
          schemaRef: binding.schemaRef,
        });
      }
    }
  }

  return hits;
}

function collectPatternHits(leaf: DecodeLeaf, vin: string, year: number): PatternHit[] {
  const bindings = getBindingsForYear(leaf, year);
  return collectHitsForBindings(leaf, vin, bindings);
}

function toCandidate(hit: PatternHit): AttributeCandidate {
  return {
    value: hit.code,
    schema: hit.schemaRef,
  };
}

function distinctCandidates(hits: readonly PatternHit[]): AttributeCandidate[] {
  const seen = new Set<string>();
  const candidates: AttributeCandidate[] = [];

  for (const hit of hits) {
    const key = `${hit.code}\0${hit.schemaRef}`;
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
        schema: hit.schemaRef,
      });
      continue;
    }

    attributes.push({
      attribute,
      value: null,
      ambiguous: true,
      candidates,
      schema: null,
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
        schema: hit.schemaRef,
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
    });
  }

  attributes.sort((left, right) => left.attribute.localeCompare(right.attribute));
  return attributes;
}

function collectTaggedHits(
  leaf: DecodeLeaf,
  vin: string,
  candidateYears: readonly number[],
): TaggedHit[] {
  const tagged: TaggedHit[] = [];

  for (const year of candidateYears) {
    const hits = collectPatternHits(leaf, vin, year);
    for (const hit of hits) {
      tagged.push({ hit, year });
    }
  }

  return tagged;
}

/** Decode a VIN against a parsed decode leaf (pure). */
export function decodeFromLeaf(
  leaf: DecodeLeaf,
  vin: string,
  wmi: DecodedWmi,
  options?: DecodeOptions,
): DecodeResult {
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
    wmi: toDecodedWmi(wmi),
    attributes: [],
    errors: validation.errors,
    warnings: validation.warnings,
  };

  if (!validation.ok) {
    return base;
  }

  if (yearAmbiguous) {
    if (modelYear.candidates.length === 0) {
      return base;
    }
    const tagged = collectTaggedHits(leaf, validation.normalized, modelYear.candidates);
    base.attributes = mergeTaggedHits(tagged, modelYear.candidates);
    return base;
  }

  const hits = collectPatternHits(leaf, validation.normalized, resolvedYear!);
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
