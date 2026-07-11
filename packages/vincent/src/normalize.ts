/**
 * Normalize a VIN: trim, uppercase, strip internal whitespace and hyphens.
 * Does not validate the result.
 */
export function normalizeVin(input: string): string {
  return input.trim().toUpperCase().replace(/[\s-]+/g, '');
}
