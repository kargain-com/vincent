/** Coarse geographic region derived from the first VIN character (ISO 3780). */
export type VinRegion =
  | 'north-america'
  | 'oceania'
  | 'south-america'
  | 'africa'
  | 'asia'
  | 'europe';

/**
 * Derive the coarse geographic region from the first VIN character.
 * Returns null when the character does not map to a known region.
 */
export function vinRegion(firstChar: string): VinRegion | null {
  if (firstChar.length !== 1) {
    return null;
  }

  const char = firstChar.toUpperCase();

  if (char >= '1' && char <= '5') {
    return 'north-america';
  }
  if (char >= '6' && char <= '7') {
    return 'oceania';
  }
  if (char >= '8' && char <= '9') {
    return 'south-america';
  }
  if (char >= 'A' && char <= 'H') {
    return 'africa';
  }
  if (char >= 'J' && char <= 'R') {
    return 'asia';
  }
  if (char >= 'S' && char <= 'Z') {
    return 'europe';
  }

  return null;
}
