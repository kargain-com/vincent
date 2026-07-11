import { parseMatchExpression } from '../protocol/parse-match.js';
import type { MatchToken } from '../protocol/types.js';

/** Protocol position 4 → 0-based index 3. */
const VDS_START_INDEX = 3;

/** Protocol position 10 → 0-based index 9. */
const VIS_START_INDEX = 9;

function matchTokens(tokens: readonly MatchToken[], vin: string, startIndex: number): boolean {
  let index = startIndex;

  for (const token of tokens) {
    if (index >= vin.length) {
      return false;
    }

    const char = vin.charAt(index);

    switch (token.kind) {
      case 'literal':
        if (char !== token.char) {
          return false;
        }
        break;
      case 'wildcard':
        break;
      case 'class':
        if (!token.chars.includes(char)) {
          return false;
        }
        break;
    }

    index += 1;
  }

  return true;
}

/**
 * Returns true when a parsed match expression applies to the VIN per PROTOCOL.md §4.3.
 * Invalid expressions return false (total function).
 */
export function matchParsedExpression(
  parsed: { vds: MatchToken[]; vis?: MatchToken[] },
  vin: string,
): boolean {
  if (!matchTokens(parsed.vds, vin, VDS_START_INDEX)) {
    return false;
  }

  if (parsed.vis !== undefined && !matchTokens(parsed.vis, vin, VIS_START_INDEX)) {
    return false;
  }

  return true;
}

/**
 * Pure matcher: evaluates match grammar tokens against VIN positions (vds@4, vis@10).
 */
export function matchExpression(match: { vds: string; vis?: string }, vin: string): boolean {
  const parsed = parseMatchExpression(match);
  if (!parsed.ok) {
    return false;
  }

  return matchParsedExpression(parsed.value, vin);
}
