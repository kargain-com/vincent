/** Deterministic VIN layer — pure functions over the VIN string. */
export const PACKAGE = '@kargain/vincent' as const;

export {
  VIN_ALPHABET,
  TRANSLITERATION,
  CHECK_DIGIT_WEIGHTS,
  YEAR_CODES,
} from './constants.js';

export { vinRegion, type VinRegion } from './region.js';

export { computeCheckDigit } from './check-digit.js';

export { normalizeVin } from './normalize.js';

export {
  validateVin,
  type VinValidation,
  type VinError,
  type VinWarning,
  type VinErrorCode,
  type VinWarningCode,
} from './validation.js';

export {
  decodeModelYear,
  type ModelYearResult,
  type DecodeModelYearOptions,
} from './model-year.js';

export { lookupWmi, type WmiInfo } from './wmi.js';
