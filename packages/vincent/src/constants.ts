/** Standard VIN alphabet: digits 0-9 and letters A-Z excluding I, O, Q. */
export const VIN_ALPHABET = '0123456789ABCDEFGHJKLMNPRSTUVWXYZ' as const;

/** Transliteration map for check-digit computation (ISO 3779 / 49 CFR 565). */
export const TRANSLITERATION: Readonly<Record<string, number>> = {
  A: 1,
  B: 2,
  C: 3,
  D: 4,
  E: 5,
  F: 6,
  G: 7,
  H: 8,
  J: 1,
  K: 2,
  L: 3,
  M: 4,
  N: 5,
  P: 7,
  R: 9,
  S: 2,
  T: 3,
  U: 4,
  V: 5,
  W: 6,
  X: 7,
  Y: 8,
  Z: 9,
  '0': 0,
  '1': 1,
  '2': 2,
  '3': 3,
  '4': 4,
  '5': 5,
  '6': 6,
  '7': 7,
  '8': 8,
  '9': 9,
};

/** Position weights for the 17-character VIN check digit (position 9). */
export const CHECK_DIGIT_WEIGHTS = [8, 7, 6, 5, 4, 3, 2, 10, 0, 9, 8, 7, 6, 5, 4, 3, 2] as const;

/** Model-year code to base years in the 30-year cycle (A=1980, 1=2001, etc.). */
export const YEAR_CODES: Readonly<Record<string, readonly number[]>> = {
  A: [1980, 2010, 2040],
  B: [1981, 2011, 2041],
  C: [1982, 2012, 2042],
  D: [1983, 2013, 2043],
  E: [1984, 2014, 2044],
  F: [1985, 2015, 2045],
  G: [1986, 2016, 2046],
  H: [1987, 2017, 2047],
  J: [1988, 2018, 2048],
  K: [1989, 2019, 2049],
  L: [1990, 2020, 2050],
  M: [1991, 2021, 2051],
  N: [1992, 2022, 2052],
  P: [1993, 2023, 2053],
  R: [1994, 2024, 2054],
  S: [1995, 2025, 2055],
  T: [1996, 2026, 2056],
  V: [1997, 2027, 2057],
  W: [1998, 2028, 2058],
  X: [1999, 2029, 2059],
  Y: [2000, 2030, 2060],
  '1': [2001, 2031, 2061],
  '2': [2002, 2032, 2062],
  '3': [2003, 2033, 2063],
  '4': [2004, 2034, 2064],
  '5': [2005, 2035, 2065],
  '6': [2006, 2036, 2066],
  '7': [2007, 2037, 2067],
  '8': [2008, 2038, 2068],
  '9': [2009, 2039, 2069],
};

/** Characters excluded from the standard VIN alphabet. */
export const EXCLUDED_VIN_CHARS = new Set(['I', 'O', 'Q']);
