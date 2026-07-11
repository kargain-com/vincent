import { computeCheckDigit, findIllegalChar, isValidVinAlphabet } from './check-digit.js';
import { decodeModelYear, type ModelYearResult } from './model-year.js';
import { normalizeVin } from './normalize.js';
import { vinRegion, type VinRegion } from './region.js';

/** Hard validation error codes. */
export type VinErrorCode = 'invalid-length' | 'illegal-character' | 'check-digit';

/** Advisory validation warning codes. */
export type VinWarningCode = 'check-digit';

/** A hard validation error. */
export interface VinError {
  code: VinErrorCode;
  message: string;
}

/** An advisory validation warning. */
export interface VinWarning {
  code: VinWarningCode;
  message: string;
}

/** Full validation result for a VIN string. */
export interface VinValidation {
  /** Normalized VIN after trim, uppercase, and stripping whitespace/hyphens. */
  normalized: string;
  /** True when there are no hard errors. */
  ok: boolean;
  /** Hard validation errors. */
  errors: VinError[];
  /** Advisory validation warnings. */
  warnings: VinWarning[];
  /** Classified VIN length: 17, legacy (11-16), or invalid. */
  length: 17 | 'legacy' | 'invalid';
  /** Coarse region from the first character, or null when unavailable. */
  region: VinRegion | null;
  /** Check-digit applicability and validation details. */
  checkDigit: {
    applicable: boolean;
    mandatory: boolean;
    valid: boolean | null;
    expected: string | null;
    actual: string | null;
  };
  /** Model year decoded from position 10 via the same logic as decodeModelYear. */
  modelYear: ModelYearResult;
}

/** Classify normalized VIN length. */
function classifyLength(normalized: string): 17 | 'legacy' | 'invalid' {
  if (normalized.length === 17) {
    return 17;
  }
  if (normalized.length >= 11 && normalized.length <= 16) {
    return 'legacy';
  }
  return 'invalid';
}

/**
 * Validate a VIN string and return structured errors, warnings, and metadata.
 */
export function validateVin(input: string): VinValidation {
  const normalized = normalizeVin(input);
  const errors: VinError[] = [];
  const warnings: VinWarning[] = [];
  const length = classifyLength(normalized);

  const illegal = findIllegalChar(normalized);
  if (illegal !== null) {
    errors.push({
      code: 'illegal-character',
      message: `Illegal VIN character: ${illegal}`,
    });
  }

  if (length === 'invalid') {
    errors.push({
      code: 'invalid-length',
      message: `Invalid VIN length: ${normalized.length} (expected 17 or legacy 11-16)`,
    });
  }

  const region = normalized.length > 0 ? vinRegion(normalized.charAt(0)) : null;

  const checkDigitApplicable = length === 17 && illegal === null && isValidVinAlphabet(normalized);
  const checkDigitMandatory = region === 'north-america';

  let checkDigitValid: boolean | null = null;
  let checkDigitExpected: string | null = null;
  let checkDigitActual: string | null = null;

  if (checkDigitApplicable) {
    checkDigitExpected = computeCheckDigit(normalized);
    checkDigitActual = normalized.charAt(8);
    checkDigitValid = checkDigitExpected === checkDigitActual;

    if (!checkDigitValid) {
      const message = `Check digit mismatch: expected ${checkDigitExpected}, got ${checkDigitActual}`;
      if (checkDigitMandatory) {
        errors.push({ code: 'check-digit', message });
      } else {
        warnings.push({ code: 'check-digit', message });
      }
    }
  }

  return {
    normalized,
    ok: errors.length === 0,
    errors,
    warnings,
    length,
    region,
    checkDigit: {
      applicable: checkDigitApplicable,
      mandatory: checkDigitMandatory,
      valid: checkDigitValid,
      expected: checkDigitExpected,
      actual: checkDigitActual,
    },
    modelYear: decodeModelYear(normalized),
  };
}
