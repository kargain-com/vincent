import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import type { Claim } from '@kargain/vincent/protocol';

import { validateVin } from '../../src/index.js';

const FIXTURE_DIR = join(
  dirname(fileURLToPath(import.meta.url)),
  '../../../../compiler/fixtures/genesis-mini',
);

const CHECK_DIGIT_ALPHABET = '0123456789ABCDEFGHJKLMNPRSTUVWXYZ';

/** Insert a valid ISO check digit at position 9 (index 8). */
export function withValidCheckDigit(template17: string): string {
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
export const VIN_BB = withValidCheckDigit('1FA12BB00BG123456');
export const VIN_BC = VIN_BODY;
export const VIN_BD = VIN_FUEL;
export const VIN_BB_VIS_G = VIN_2011;
export const VIN_BB_VIS_H = withValidCheckDigit('1FA12BB00BH123456');

export function loadGenesisMiniClaims(): Claim[] {
  return JSON.parse(readFileSync(join(FIXTURE_DIR, 'claims.json'), 'utf8')) as Claim[];
}

export const TEST_PRIVATE_KEY =
  '0xac0974bec39a17e36ba4a6b4d238ff944bacb478cab039431e99c5825582831';
