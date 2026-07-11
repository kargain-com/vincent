import { describe, expect, it, vi } from 'vitest';
import {
  CHECK_DIGIT_WEIGHTS,
  computeCheckDigit,
  decodeModelYear,
  lookupWmi,
  normalizeVin,
  PACKAGE,
  TRANSLITERATION,
  validateVin,
  vinRegion,
  VIN_ALPHABET,
  YEAR_CODES,
} from '@kargain/vincent';
import { findIllegalChar, isValidVinAlphabet } from '../src/check-digit.js';

describe('PACKAGE', () => {
  it('exports package name', () => {
    expect(PACKAGE).toBe('@kargain/vincent');
  });
});

describe('constants', () => {
  it('exports VIN_ALPHABET without I, O, Q', () => {
    expect(VIN_ALPHABET).not.toMatch(/[IOQ]/);
    expect(VIN_ALPHABET.length).toBe(33);
  });

  it('exports TRANSLITERATION for all alphabet chars', () => {
    for (const char of VIN_ALPHABET) {
      expect(TRANSLITERATION[char]).toBeTypeOf('number');
    }
  });

  it('exports CHECK_DIGIT_WEIGHTS with 17 entries', () => {
    expect(CHECK_DIGIT_WEIGHTS).toHaveLength(17);
    expect(CHECK_DIGIT_WEIGHTS[8]).toBe(0);
  });

  it('exports YEAR_CODES for every model-year code', () => {
    const expectedCodes = [
      'A', 'B', 'C', 'D', 'E', 'F', 'G', 'H', 'J', 'K', 'L', 'M', 'N', 'P', 'R', 'S', 'T', 'V', 'W', 'X', 'Y',
      '1', '2', '3', '4', '5', '6', '7', '8', '9',
    ];
    expect(Object.keys(YEAR_CODES).sort()).toEqual(expectedCodes.sort());
    for (const code of expectedCodes) {
      expect(YEAR_CODES[code]).toHaveLength(3);
    }
  });
});

describe('normalizeVin', () => {
  it('trims, uppercases, and strips whitespace and hyphens', () => {
    expect(normalizeVin('  1hgcm82633a004352  ')).toBe('1HGCM82633A004352');
    expect(normalizeVin('1-HGC-M826-33A004352')).toBe('1HGCM82633A004352');
    expect(normalizeVin('1 H G C M 8 2 6 3 3 A 0 0 4 3 5 2')).toBe('1HGCM82633A004352');
  });

  it('does not validate characters', () => {
    expect(normalizeVin('ioq')).toBe('IOQ');
  });
});

describe('vinRegion', () => {
  it('maps ISO 3780 ranges', () => {
    expect(vinRegion('1')).toBe('north-america');
    expect(vinRegion('5')).toBe('north-america');
    expect(vinRegion('6')).toBe('oceania');
    expect(vinRegion('7')).toBe('oceania');
    expect(vinRegion('8')).toBe('south-america');
    expect(vinRegion('9')).toBe('south-america');
    expect(vinRegion('A')).toBe('africa');
    expect(vinRegion('H')).toBe('africa');
    expect(vinRegion('J')).toBe('asia');
    expect(vinRegion('R')).toBe('asia');
    expect(vinRegion('S')).toBe('europe');
    expect(vinRegion('Z')).toBe('europe');
  });

  it('returns null for unmapped first characters', () => {
    expect(vinRegion('I')).toBeNull();
    expect(vinRegion('')).toBeNull();
    expect(vinRegion('ab')).toBeNull();
  });

  it('maps O and Q within the J-R asia range', () => {
    expect(vinRegion('O')).toBe('asia');
    expect(vinRegion('Q')).toBe('asia');
  });
});

describe('computeCheckDigit', () => {
  it('computes check digit for a known valid NA VIN', () => {
    expect(computeCheckDigit('1HGCM82633A004352')).toBe('3');
  });

  it('handles the all-ones edge case where check digit equals 1', () => {
    expect(computeCheckDigit('11111111111111111')).toBe('1');
  });

  it('returns X when remainder is 10', () => {
    expect(computeCheckDigit('X60DG03SUVDNKY64F')).toBe('X');
  });

  it('throws TypeError on wrong length', () => {
    expect(() => computeCheckDigit('SHORT')).toThrow(TypeError);
    expect(() => computeCheckDigit('TOO-LONG-VIN-HERE!!')).toThrow(/exactly 17/);
  });

  it('throws TypeError on illegal characters', () => {
    expect(() => computeCheckDigit('1HGCM82633A00435I')).toThrow(/Illegal VIN character: I/);
    expect(() => computeCheckDigit('1HGCM82633A00435@')).toThrow(/Illegal VIN character: @/);
  });
});

describe('internal alphabet helpers', () => {
  it('accepts valid alphabet', () => {
    expect(isValidVinAlphabet('1HGCM82633A004352')).toBe(true);
    expect(findIllegalChar('1HGCM82633A004352')).toBeNull();
  });

  it('rejects I, O, Q and other illegal chars', () => {
    expect(isValidVinAlphabet('1HGCM82633A00435I')).toBe(false);
    expect(findIllegalChar('1HGCM82633A00435I')).toBe('I');
    expect(findIllegalChar('1HGCM82633A00435O')).toBe('O');
    expect(findIllegalChar('1HGCM82633A00435Q')).toBe('Q');
    expect(findIllegalChar('1HGCM82633A00435@')).toBe('@');
    expect(isValidVinAlphabet('1@3456')).toBe(false);
  });
});

describe('validateVin alphabet checks', () => {
  it('rejects I, O, Q and other illegal chars via validateVin', () => {
    expect(validateVin('1HGCM82633A00435I').errors.some((e) => e.code === 'illegal-character')).toBe(true);
    expect(validateVin('1HGCM82633A00435O').errors.some((e) => e.code === 'illegal-character')).toBe(true);
    expect(validateVin('1HGCM82633A00435Q').errors.some((e) => e.code === 'illegal-character')).toBe(true);
    expect(validateVin('1@GCM82633A004352').errors.some((e) => e.code === 'illegal-character')).toBe(true);
  });
});

describe('validateVin', () => {
  it('validates a known valid NA VIN', () => {
    const result = validateVin('1HGCM82633A004352');
    expect(result.ok).toBe(true);
    expect(result.normalized).toBe('1HGCM82633A004352');
    expect(result.length).toBe(17);
    expect(result.region).toBe('north-america');
    expect(result.errors).toHaveLength(0);
    expect(result.warnings).toHaveLength(0);
    expect(result.checkDigit).toEqual({
      applicable: true,
      mandatory: true,
      valid: true,
      expected: '3',
      actual: '3',
    });
  });

  it('accepts all-ones VIN as valid check digit edge case', () => {
    const result = validateVin('11111111111111111');
    expect(result.ok).toBe(true);
    expect(result.checkDigit.valid).toBe(true);
    expect(result.checkDigit.expected).toBe('1');
    expect(result.checkDigit.actual).toBe('1');
  });

  it('errors on NA VIN with invalid check digit', () => {
    const result = validateVin('1HGCM82631A004352');
    expect(result.ok).toBe(false);
    expect(result.errors.some((e) => e.code === 'check-digit')).toBe(true);
    expect(result.checkDigit.valid).toBe(false);
  });

  it('warns on European VIN check digit failure', () => {
    const result = validateVin('WAUZZZ8V9KA123456');
    expect(result.region).toBe('europe');
    expect(result.checkDigit.mandatory).toBe(false);
    expect(result.ok).toBe(true);
    expect(result.errors).toHaveLength(0);
    expect(result.warnings.some((w) => w.code === 'check-digit')).toBe(true);
  });

  it('warns on VF3 VIN check digit failure outside NA', () => {
    const result = validateVin('VF3ABC12345678901');
    expect(result.region).toBe('europe');
    expect(result.warnings.some((w) => w.code === 'check-digit')).toBe(true);
    expect(result.ok).toBe(true);
  });

  it('normalizes lowercase and hyphenated input', () => {
    const result = validateVin('1-hgcm82633a004352');
    expect(result.normalized).toBe('1HGCM82633A004352');
    expect(result.ok).toBe(true);
  });

  it('rejects I, O, Q anywhere', () => {
    expect(validateVin('1IGCM82633A004352').errors.some((e) => e.code === 'illegal-character')).toBe(true);
    expect(validateVin('1HGCM82633A00435O').errors.some((e) => e.code === 'illegal-character')).toBe(true);
    expect(validateVin('1HGCM82633A0043Q2').errors.some((e) => e.code === 'illegal-character')).toBe(true);
  });

  it('classifies lengths 10-18', () => {
    const base = '1HGCM82633A';

    for (let len = 10; len <= 18; len++) {
      const vin = base.padEnd(len, '0').slice(0, len);
      const result = validateVin(vin);

      if (len === 17) {
        expect(result.length).toBe(17);
      } else if (len >= 11 && len <= 16) {
        expect(result.length).toBe('legacy');
        expect(result.errors.some((e) => e.code === 'invalid-length')).toBe(false);
        expect(result.checkDigit.applicable).toBe(false);
      } else {
        expect(result.length).toBe('invalid');
        expect(result.errors.some((e) => e.code === 'invalid-length')).toBe(true);
      }
    }
  });

  it('accepts legacy 13-char VIN without length error', () => {
    const result = validateVin('1234567890123');
    expect(result.length).toBe('legacy');
    expect(result.ok).toBe(true);
    expect(result.checkDigit.applicable).toBe(false);
    expect(result.region).toBe('north-america');
  });

  it('derives region from first char even when other chars are illegal', () => {
    const result = validateVin('1HGCM82633A00435I');
    expect(result.region).toBe('north-america');
  });

  it('returns null region when first char is unmapped', () => {
    const result = validateVin('IHGCM82633A004352');
    expect(result.region).toBeNull();
  });

  it('handles empty input', () => {
    const result = validateVin('   ');
    expect(result.normalized).toBe('');
    expect(result.region).toBeNull();
    expect(result.length).toBe('invalid');
    expect(result.modelYear).toEqual({
      code: null,
      candidates: [],
      best: null,
      method: 'invalid',
    });
  });
});

describe('validateVin modelYear', () => {
  it('includes modelYear on every result matching decodeModelYear', () => {
    const inputs = [
      '1HGCM82633A004352',
      'WAUZZZ8V9KA123456',
      '1234567890123',
      '1HGCM8263I0043520',
      'short',
    ];

    for (const input of inputs) {
      const result = validateVin(input);
      expect(result.modelYear).toEqual(decodeModelYear(result.normalized));
    }
  });

  it('decodes modelYear on a 17-char NA VIN', () => {
    const result = validateVin('1HGCM82633A004352');
    expect(result.modelYear.code).toBe('3');
    expect(result.modelYear.best).toBeTypeOf('number');
    expect(['single-candidate', 'na-position7']).toContain(result.modelYear.method);
  });

  it('decodes modelYear on a 17-char EU VIN as ambiguous when multiple candidates survive cap', () => {
    const result = validateVin('WAUZZZ8V9KA123456');
    expect(result.modelYear.code).toBe('K');
    expect(result.modelYear.candidates.length).toBeGreaterThan(1);
    expect(result.modelYear.candidates.every((year) => year <= new Date().getFullYear() + 1)).toBe(true);
    expect(result.modelYear.best).toBeNull();
    expect(result.modelYear.method).toBe('ambiguous');
  });

  it('decodes modelYear on a legacy VIN with invalid position 10', () => {
    const result = validateVin('1234567890123');
    expect(result.modelYear).toEqual({
      code: '0',
      candidates: [],
      best: null,
      method: 'invalid',
    });
  });

  it('decodes modelYear on an invalid-alphabet VIN with unusable position 10', () => {
    const result = validateVin('1HGCM8263I0043520');
    expect(result.ok).toBe(false);
    expect(result.modelYear).toEqual({
      code: 'I',
      candidates: [],
      best: null,
      method: 'invalid',
    });
  });
});

describe('decodeModelYear', () => {
  it('decodes every YEAR_CODES entry with cap', () => {
    const now = new Date('2026-07-11');
    for (const [code, years] of Object.entries(YEAR_CODES)) {
      const vin = `1HGCM8263${code}A004352`;
      const result = decodeModelYear(vin, { now });
      expect(result.code).toBe(code);
      expect(result.candidates.length).toBeGreaterThan(0);
      expect(result.candidates.every((y) => y <= 2027)).toBe(true);
      expect(result.candidates).toEqual(years.filter((y) => y <= 2027));
    }
  });

  it('uses NA position-7 alphabetic heuristic (2010+ cycle)', () => {
    const vin = '1HGCM8A33D0043522';
    const result = decodeModelYear(vin, { now: new Date('2026-07-11') });
    expect(result.code).toBe('D');
    expect(result.method).toBe('na-position7');
    expect(result.candidates).toEqual([1983, 2013]);
    expect(result.best).toBe(2013);
  });

  it('uses NA position-7 numeric heuristic (1980-2009 cycle)', () => {
    const vin = '1HGCM8233D0043522';
    const result = decodeModelYear(vin, { now: new Date('2026-07-11') });
    expect(result.code).toBe('D');
    expect(result.method).toBe('na-position7');
    expect(result.best).toBe(1983);
  });

  it('returns single-candidate when only one year survives cap', () => {
    const vin = '1HGCM8263D004352';
    const result = decodeModelYear(vin, { now: new Date('1982-01-01') });
    expect(result.candidates).toEqual([1983]);
    expect(result.method).toBe('single-candidate');
    expect(result.best).toBe(1983);
  });

  it('returns ambiguous for non-NA multi-candidate VINs', () => {
    const vin = 'WAUZZZ8V9D123456';
    const result = decodeModelYear(vin, { now: new Date('2026-07-11') });
    expect(result.code).toBe('D');
    expect(result.method).toBe('ambiguous');
    expect(result.best).toBeNull();
    expect(result.candidates).toEqual([1983, 2013]);
  });

  it('returns invalid for short VINs', () => {
    expect(decodeModelYear('123456789')).toEqual({
      code: null,
      candidates: [],
      best: null,
      method: 'invalid',
    });
  });

  it('returns invalid for unknown year code', () => {
    const vin = '1HGCM82630043520';
    const result = decodeModelYear(vin, { now: new Date('2026-07-11') });
    expect(result.code).toBe('0');
    expect(result.method).toBe('invalid');
  });

  it('returns invalid when all candidates exceed cap', () => {
    const vin = '1HGCM82609A004352';
    const result = decodeModelYear(vin, { now: new Date('1970-01-01') });
    expect(result.code).toBe('9');
    expect(result.candidates).toEqual([]);
    expect(result.method).toBe('invalid');
  });

  it('returns invalid when model year code char is missing', () => {
    const result = decodeModelYear('');
    expect(result.method).toBe('invalid');
  });
});

describe('lookupWmi', () => {
  it('does not decode WMI data until the first lookupWmi call', async () => {
    vi.resetModules();
    const inflateModule = await import('../src/inflate.vendored.js');
    const inflateSpy = vi.spyOn(inflateModule, 'inflateRawDeflate');

    const { validateVin, lookupWmi: lazyLookupWmi } = await import('@kargain/vincent');

    validateVin('1HGCM82633A004352');
    expect(inflateSpy).not.toHaveBeenCalled();

    lazyLookupWmi('1HG');
    expect(inflateSpy).toHaveBeenCalledTimes(1);

    lazyLookupWmi('VF3');
    expect(inflateSpy).toHaveBeenCalledTimes(1);

    inflateSpy.mockRestore();
  });

  it('resolves known WMIs across regions', () => {
    expect(lookupWmi('1HG')).toEqual({
      wmi: '1HG',
      manufacturer: 'AMERICAN HONDA MOTOR CO., INC.',
      country: 'UNITED STATES (USA)',
      vehicleType: 'Passenger Car',
    });
    expect(lookupWmi('VF3')).toEqual({
      wmi: 'VF3',
      manufacturer: 'AUTOMOBILES PEUGEOT',
      country: 'FRANCE',
      vehicleType: 'Passenger Car',
    });
    expect(lookupWmi('WAU')).toEqual({
      wmi: 'WAU',
      manufacturer: 'AUDI AG',
      country: 'GERMANY',
      vehicleType: 'Passenger Car',
    });
    expect(lookupWmi('JHM')).toEqual({
      wmi: 'JHM',
      manufacturer: 'HONDA MOTOR CO., LTD.',
      country: null,
      vehicleType: 'Passenger Car',
    });
  });

  it('resolves extended WMI from a full 17-char VIN when position 3 is 9', () => {
    const vin = '2W9ABCDEFGH044123';
    expect(lookupWmi(vin)).toEqual({
      wmi: '2W9044',
      manufacturer: 'WESTWARD INDUSTRIES LTD.',
      country: 'CANADA',
      vehicleType: 'Motorcycle',
    });
  });

  it('resolves bare 6-char extended WMI input', () => {
    expect(lookupWmi('2W9044')).toEqual({
      wmi: '2W9044',
      manufacturer: 'WESTWARD INDUSTRIES LTD.',
      country: 'CANADA',
      vehicleType: 'Motorcycle',
    });
  });

  it('returns null for unknown WMI', () => {
    expect(lookupWmi('ZZZ')).toBeNull();
    expect(lookupWmi('ZZZZZZZZZZZZZZZZZ')).toBeNull();
  });

  it('returns null for inputs shorter than 3 characters', () => {
    expect(lookupWmi('')).toBeNull();
    expect(lookupWmi('AB')).toBeNull();
  });

  it('matches bare WMI and full VIN for the same manufacturer', () => {
    const bare = lookupWmi('1HG');
    const vin = lookupWmi('1HGCM82633A004352');
    expect(bare).not.toBeNull();
    expect(vin).toEqual(bare);
  });

  it('falls back from unknown 6-char prefix to matching 3-char WMI', () => {
    expect(lookupWmi('1HG000')).toEqual(lookupWmi('1HG'));
  });

  it('normalizes lowercase and hyphenated input', () => {
    expect(lookupWmi('1hg')).toEqual(lookupWmi('1HG'));
    expect(lookupWmi('vf-3')).toEqual(lookupWmi('VF3'));
  });
});
