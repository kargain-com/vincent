import type { MatchExpression } from '@kargain/vincent/protocol';
import { parseMatchExpression } from '@kargain/vincent/protocol';
import { matchExpression } from '@kargain/vincent/decoder';
import { validateVin } from '@kargain/vincent';

const CHECK_DIGIT_ALPHABET = '0123456789ABCDEFGHJKLMNPRSTUVWXYZ';

/** Protocol position 4 → 0-based index 3. */
const VDS_START_INDEX = 3;

/** Protocol position 10 → 0-based index 9. */
const VIS_START_INDEX = 9;

/** Expand match tokens to concrete VIN characters. */
export function expandMatchTokens(
  tokens: MatchExpression['vds'],
  length: number,
): string {
  let result = '';
  for (const token of tokens) {
    switch (token.kind) {
      case 'literal':
        result += token.char;
        break;
      case 'wildcard':
        result += '0';
        break;
      case 'class':
        result += token.chars[0] ?? '0';
        break;
    }
  }
  while (result.length < length) {
    result += '0';
  }
  return result.slice(0, length);
}

/** Insert a valid ISO check digit at position 9 (index 8). */
export function withValidCheckDigit(template17: string): string {
  if (template17.length !== 17) {
    throw new Error(`Expected 17-character VIN template, got ${String(template17.length)}`);
  }

  for (const char of CHECK_DIGIT_ALPHABET) {
    const candidate = template17.slice(0, 8) + char + template17.slice(9);
    if (validateVin(candidate).ok) {
      return candidate;
    }
  }

  throw new Error(`No valid check digit for template ${template17}`);
}

export function synthesizeVin(
  wmi: string,
  match: { vds: string; vis?: string },
): string {
  const parsed = parseMatchExpression(match);
  if (!parsed.ok) {
    throw new Error(`invalid match expression: ${match.vds}`);
  }

  const chars = Array.from({ length: 17 }, () => '0');
  for (let i = 0; i < wmi.length && i < 17; i++) {
    chars[i] = wmi[i]!;
  }

  const vdsExpanded = expandMatchTokens(parsed.value.vds, 6);
  for (let i = 0; i < vdsExpanded.length && VDS_START_INDEX + i < 17; i++) {
    chars[VDS_START_INDEX + i] = vdsExpanded[i]!;
  }

  if (parsed.value.vis !== undefined) {
    const visExpanded = expandMatchTokens(parsed.value.vis, 8);
    for (let i = 0; i < visExpanded.length && VIS_START_INDEX + i < 17; i++) {
      chars[VIS_START_INDEX + i] = visExpanded[i]!;
    }
  }

  chars[8] = '0';
  const vin = withValidCheckDigit(chars.join(''));

  if (!matchExpression(match, vin)) {
    throw new Error(`synthesized VIN does not match pattern: ${vin}`);
  }

  return vin;
}

/** Deterministic index selection from a numeric seed string. */
export function deterministicSampleIndices(
  total: number,
  count: number,
  seedHex: string,
): number[] {
  if (count >= total) {
    return Array.from({ length: total }, (_, i) => i);
  }

  const indices: number[] = [];
  let state = BigInt(`0x${seedHex.slice(0, 16)}`);

  while (indices.length < count) {
    state = (state * 6364136223846793005n + 1n) & ((1n << 64n) - 1n);
    const idx = Number(state % BigInt(total));
    if (!indices.includes(idx)) {
      indices.push(idx);
    }
  }

  return indices.sort((a, b) => a - b);
}
