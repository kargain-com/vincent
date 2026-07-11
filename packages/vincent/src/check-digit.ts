import { CHECK_DIGIT_WEIGHTS, EXCLUDED_VIN_CHARS, TRANSLITERATION } from './constants.js';

/** Returns true when every character is in the standard VIN alphabet. */
export function isValidVinAlphabet(vin: string): boolean {
  for (const char of vin) {
    if (EXCLUDED_VIN_CHARS.has(char)) {
      return false;
    }
    if (!TRANSLITERATION[char] && (char < '0' || char > '9')) {
      return false;
    }
  }
  return true;
}

/** Find the first character that violates the standard VIN alphabet. */
export function findIllegalChar(vin: string): string | null {
  for (const char of vin) {
    if (EXCLUDED_VIN_CHARS.has(char)) {
      return char;
    }
    if (char >= '0' && char <= '9') {
      continue;
    }
    if (!TRANSLITERATION[char]) {
      return char;
    }
  }
  return null;
}

/** Transliterate a single VIN character to its numeric check-digit value. */
function transliterate(char: string): number {
  if (char >= '0' && char <= '9') {
    return Number(char);
  }
  return TRANSLITERATION[char];
}

/**
 * Compute the check digit for a 17-character VIN string.
 * @throws {TypeError} When length is not 17 or characters are illegal.
 */
export function computeCheckDigit(vin17: string): string {
  if (vin17.length !== 17) {
    throw new TypeError(`VIN must be exactly 17 characters, got ${vin17.length}`);
  }

  const illegal = findIllegalChar(vin17);
  if (illegal !== null) {
    throw new TypeError(`Illegal VIN character: ${illegal}`);
  }

  let sum = 0;
  for (let i = 0; i < 17; i++) {
    const char = vin17.charAt(i);
    sum += transliterate(char) * CHECK_DIGIT_WEIGHTS[i];
  }

  const remainder = sum % 11;
  return remainder === 10 ? 'X' : String(remainder);
}
