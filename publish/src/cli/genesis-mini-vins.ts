import { validateVin } from '@kargain/vincent';

const CHECK_DIGIT_ALPHABET = '0123456789ABCDEFGHJKLMNPRSTUVWXYZ';

function withValidCheckDigit(template17: string): string {
  if (template17.length !== 17) {
    throw new Error(`Expected 17-character VIN template, got ${template17.length}`);
  }

  for (const char of CHECK_DIGIT_ALPHABET) {
    const candidate = template17.slice(0, 8) + char + template17.slice(9);
    if (validateVin(candidate).ok) {
      return candidate;
    }
  }

  throw new Error(`No valid check digit for template ${template17}`);
}

export const VIN_2011 = withValidCheckDigit('1FA12BB00BG123456');
export const VIN_2014 = withValidCheckDigit('1FA12BB00EG123456');
export const VIN_BODY = withValidCheckDigit('1FA12BC01BG123456');
export const VIN_FUEL = withValidCheckDigit('1FA12BD03BG123456');
export const VIN_PLANT = withValidCheckDigit('1FA12BE05BG123456');
