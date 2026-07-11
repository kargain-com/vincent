import { MATCH_LITERAL_CHARS } from './constants.js';
import { fail } from './parse-utils.js';
import type { MatchClassToken, MatchToken, ParseResult } from './types.js';

const LITERAL_SET = new Set(MATCH_LITERAL_CHARS);

function isLiteralChar(char: string): boolean {
  return char.length === 1 && LITERAL_SET.has(char);
}

function parseCharClass(segment: string, start: number): ParseResult<{ token: MatchClassToken; next: number }> {
  let i = start + 1;
  const chars = new Set<string>();

  if (i >= segment.length || segment[i] === ']') {
    return fail('invalid-match', 'Empty character class');
  }

  while (i < segment.length && segment[i] !== ']') {
    if (segment[i] === '^') {
      return fail('invalid-match', 'Negation is not allowed in character classes');
    }

    const char = segment[i];
    if (!isLiteralChar(char)) {
      return fail('invalid-match', `Invalid character in class: ${char}`);
    }

    if (i + 2 < segment.length && segment[i + 1] === '-') {
      const endChar = segment[i + 2];
      if (!isLiteralChar(endChar)) {
        return fail('invalid-match', `Invalid range end in class: ${endChar}`);
      }
      const startCode = char.charCodeAt(0);
      const endCode = endChar.charCodeAt(0);
      if (startCode > endCode) {
        return fail('invalid-match', 'Invalid character range in class');
      }
      for (let code = startCode; code <= endCode; code++) {
        chars.add(String.fromCharCode(code));
      }
      i += 3;
      continue;
    }

    chars.add(char);
    i += 1;
  }

  if (i >= segment.length || segment[i] !== ']') {
    return fail('invalid-match', 'Unbalanced character class');
  }

  return {
    ok: true,
    value: {
      token: { kind: 'class', chars: [...chars].sort() },
      next: i + 1,
    },
  };
}

/** Parse and validate a single match segment per PROTOCOL.md §4.3 (grammar only). */
export function parseMatchSegment(segment: string): ParseResult<MatchToken[]> {
  if (typeof segment !== 'string') {
    return fail('invalid-match', 'Match segment must be a string');
  }

  const tokens: MatchToken[] = [];
  let i = 0;

  while (i < segment.length) {
    const char = segment[i];

    if (char === '*') {
      tokens.push({ kind: 'wildcard' });
      i += 1;
      continue;
    }

    if (char === '[') {
      const parsed = parseCharClass(segment, i);
      if (!parsed.ok) {
        return parsed;
      }
      tokens.push(parsed.value.token);
      i = parsed.value.next;
      continue;
    }

    if (!isLiteralChar(char)) {
      return fail('invalid-match', `Invalid match character: ${char}`);
    }

    tokens.push({ kind: 'literal', char });
    i += 1;
  }

  if (tokens.length === 0) {
    return fail('invalid-match', 'Match segment must not be empty');
  }

  return { ok: true, value: tokens };
}

/** Parse a match object with vds and optional vis segments. */
export function parseMatchExpression(match: {
  vds: string;
  vis?: string;
}): ParseResult<{ vds: MatchToken[]; vis?: MatchToken[] }> {
  const vds = parseMatchSegment(match.vds);
  if (!vds.ok) {
    return vds;
  }

  if (match.vis === undefined) {
    return { ok: true, value: { vds: vds.value } };
  }

  const vis = parseMatchSegment(match.vis);
  if (!vis.ok) {
    return vis;
  }

  return { ok: true, value: { vds: vds.value, vis: vis.value } };
}
