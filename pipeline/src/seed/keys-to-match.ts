import { parseMatchExpression } from '@kargain/vincent/protocol';
import type { MatchExpression } from '@kargain/vincent/protocol';

const VIN_ALPHABET = '0123456789ABCDEFGHJKLMNPRSTUVWXYZ';
const VIN_ALPHABET_SET = new Set(VIN_ALPHABET);
const STRIPPED_CLASS_CHARS = new Set(['I', 'O', 'Q']);

export interface KeysToMatchResult {
  ok: true;
  /** Parsed tokens for synthesis / tests. */
  match: MatchExpression;
  /** Sanitized segments for claim keys (I/O/Q stripped from classes). */
  claimMatch: { vds: string; vis?: string };
}

export interface KeysToMatchFailure {
  ok: false;
  reason: string;
}

export type KeysToMatchOutcome = KeysToMatchResult | KeysToMatchFailure;

export function classifyKeysFailure(message: string): string {
  if (message.includes('Negation')) {
    return 'negation';
  }
  if (message.includes('Unbalanced')) {
    return 'unbalanced-class';
  }
  if (message.includes('Empty character class')) {
    return 'empty-class';
  }
  if (message.includes('Invalid match character: I')) {
    return 'char:I';
  }
  if (message.includes('Invalid match character: O')) {
    return 'char:O';
  }
  if (message.includes('Invalid match character: Q')) {
    return 'char:Q';
  }
  if (message.includes('Invalid match character: #')) {
    return 'char:#';
  }
  if (message.includes('Invalid match character: _')) {
    return 'char:_';
  }
  if (message.includes('must not be empty')) {
    return 'empty-segment';
  }
  const charMatch = /Invalid match character: (.)/.exec(message);
  if (charMatch !== null) {
    return `char:${charMatch[1]}`;
  }
  return 'other';
}

function isVinChar(char: string): boolean {
  return char.length === 1 && VIN_ALPHABET_SET.has(char);
}

function expandPermissiveClass(
  body: string,
): { ok: true; chars: string[] } | KeysToMatchFailure {
  if (body.length === 0) {
    return { ok: false, reason: 'empty-class' };
  }

  const chars = new Set<string>();
  let i = 0;

  while (i < body.length) {
    if (body[i] === '^') {
      return { ok: false, reason: 'negation' };
    }

    const char = body[i];
    if (i + 2 < body.length && body[i + 1] === '-') {
      const endChar = body[i + 2];
      if (char.length !== 1 || endChar.length !== 1) {
        return { ok: false, reason: 'other' };
      }
      const startCode = char.charCodeAt(0);
      const endCode = endChar.charCodeAt(0);
      if (startCode > endCode) {
        return { ok: false, reason: 'other' };
      }
      for (let code = startCode; code <= endCode; code++) {
        const expanded = String.fromCharCode(code);
        if (isVinChar(expanded)) {
          chars.add(expanded);
        }
      }
      i += 3;
      continue;
    }

    if (isVinChar(char)) {
      chars.add(char);
    }
    i += 1;
  }

  if (chars.size === 0) {
    return { ok: false, reason: 'empty-class' };
  }

  return { ok: true, chars: [...chars].sort() };
}

/** Sanitize a match segment: strip I/O/Q from classes; reject literal I/O/Q outside classes. */
export function sanitizeMatchSegment(
  segment: string,
): { ok: true; segment: string } | KeysToMatchFailure {
  let result = '';
  let i = 0;

  while (i < segment.length) {
    const char = segment[i];

    if (char === '*') {
      result += '*';
      i += 1;
      continue;
    }

    if (char === '[') {
      const classEnd = segment.indexOf(']', i + 1);
      if (classEnd === -1) {
        return { ok: false, reason: 'unbalanced-class' };
      }

      const expanded = expandPermissiveClass(segment.slice(i + 1, classEnd));
      if (!expanded.ok) {
        return expanded;
      }

      result += `[${expanded.chars.join('')}]`;
      i = classEnd + 1;
      continue;
    }

    if (STRIPPED_CLASS_CHARS.has(char)) {
      return { ok: false, reason: `char:${char}` };
    }

    if (!isVinChar(char)) {
      return { ok: false, reason: classifyKeysFailure(`Invalid match character: ${char}`) };
    }

    result += char;
    i += 1;
  }

  if (result.length === 0) {
    return { ok: false, reason: 'empty-segment' };
  }

  return { ok: true, segment: result };
}

function finishKeysToMatch(
  vdsSegment: string,
  visSegment: string | undefined,
): KeysToMatchOutcome {
  const vdsSanitized = sanitizeMatchSegment(vdsSegment);
  if (!vdsSanitized.ok) {
    return vdsSanitized;
  }

  let visSanitized: string | undefined;
  if (visSegment !== undefined) {
    const sanitizedVis = sanitizeMatchSegment(visSegment);
    if (!sanitizedVis.ok) {
      return sanitizedVis;
    }
    visSanitized = sanitizedVis.segment;
  }

  const claimMatch =
    visSanitized === undefined
      ? { vds: vdsSanitized.segment }
      : { vds: vdsSanitized.segment, vis: visSanitized };

  const parsed = parseMatchExpression(claimMatch);
  if (!parsed.ok) {
    return { ok: false, reason: classifyKeysFailure(parsed.error.message) };
  }

  return { ok: true, match: parsed.value, claimMatch };
}

/** Convert vPIC pattern keys to protocol match object. */
export function keysToMatch(keys: string): KeysToMatchOutcome {
  const pipeIndex = keys.indexOf('|');
  if (pipeIndex === -1) {
    return finishKeysToMatch(keys, undefined);
  }

  const vdsSegment = keys.slice(0, pipeIndex);
  const visSegment = keys.slice(pipeIndex + 1);
  if (visSegment.includes('|')) {
    return { ok: false, reason: 'multi-pipe' };
  }
  if (vdsSegment.length === 0 || visSegment.length === 0) {
    return { ok: false, reason: 'empty-segment' };
  }

  return finishKeysToMatch(vdsSegment, visSegment);
}

/** Serialize match for claim key (omit vis when absent). Prefer original vPIC segments from keysToMatch. */
export function matchToClaimKey(match: MatchExpression): { vds: string; vis?: string } {
  const result: { vds: string; vis?: string } = {
    vds: tokensToSegment(match.vds),
  };
  if (match.vis !== undefined) {
    result.vis = tokensToSegment(match.vis);
  }
  return result;
}

function tokensToSegment(tokens: MatchExpression['vds']): string {
  let segment = '';
  for (const token of tokens) {
    switch (token.kind) {
      case 'literal':
        segment += token.char;
        break;
      case 'wildcard':
        segment += '*';
        break;
      case 'class':
        segment += `[${token.chars.join('')}]`;
        break;
    }
  }
  return segment;
}
