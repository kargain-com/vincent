import { YEAR_CODES } from './constants.js';
import { normalizeVin } from './normalize.js';
import { vinRegion } from './region.js';

/** Result of decoding the model year from position 10 of a VIN. */
export interface ModelYearResult {
  /** Model-year code at position 10, or null when unavailable. */
  code: string | null;
  /** Candidate years in ascending order, capped at currentYear + 1. */
  candidates: number[];
  /** Resolved year when unambiguous or NA heuristic applies, else null. */
  best: number | null;
  /** Method used to resolve or classify the model year. */
  method: 'na-position7' | 'single-candidate' | 'ambiguous' | 'invalid';
}

/** Options for model-year decoding. */
export interface DecodeModelYearOptions {
  /** Reference date for year capping; defaults to the current clock. */
  now?: Date;
}

const POSITION7_INDEX = 6;
const MODEL_YEAR_INDEX = 9;

/** Returns true when position 7 is an alphabetic character. */
function isPosition7Alphabetic(vin: string): boolean {
  const char = vin[POSITION7_INDEX];
  return char !== undefined && char >= 'A' && char <= 'Z';
}

/** Cap candidate years at currentYear + 1 and return them in ascending order. */
function capCandidates(baseYears: readonly number[], currentYear: number): number[] {
  const cap = currentYear + 1;
  return baseYears.filter((year) => year <= cap);
}

/**
 * Decode the model year from a VIN using the 30-year cycle and NA position-7 heuristic.
 */
export function decodeModelYear(vin: string, options?: DecodeModelYearOptions): ModelYearResult {
  const normalized = normalizeVin(vin);
  const currentYear = (options?.now ?? new Date()).getFullYear();

  if (normalized.length < 10) {
    return { code: null, candidates: [], best: null, method: 'invalid' };
  }

  const code = normalized.charAt(MODEL_YEAR_INDEX);
  const baseYears = YEAR_CODES[code];
  if (baseYears === undefined) {
    return { code, candidates: [], best: null, method: 'invalid' };
  }

  const candidates = capCandidates(baseYears, currentYear);

  if (candidates.length === 0) {
    return { code, candidates, best: null, method: 'invalid' };
  }

  if (candidates.length === 1) {
    return { code, candidates, best: candidates[0], method: 'single-candidate' };
  }

  const region = vinRegion(normalized.charAt(0));
  if (region === 'north-america') {
    const use2010Cycle = isPosition7Alphabetic(normalized);
    const best = use2010Cycle ? candidates[1] : candidates[0];
    return { code, candidates, best, method: 'na-position7' };
  }

  return { code, candidates, best: null, method: 'ambiguous' };
}
