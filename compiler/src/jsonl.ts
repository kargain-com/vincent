import type { Claim } from '@kargain/vincent/protocol';

import { contentSha256 } from './hash-content.js';
import type { PreparedClaim } from './prepared-claim.js';
import { prepareClaims } from './prepared-claim.js';

/** Emit canonical JSONL from precomputed claim lines. */
export function emitJsonlFromPrepared(
  prepared: readonly PreparedClaim[],
): { jsonl: string; jsonlSha256: string } {
  const lines = prepared.map((entry) => entry.canonical);
  const jsonl = lines.length === 0 ? '' : `${lines.join('\n')}\n`;
  return { jsonl, jsonlSha256: contentSha256(jsonl) };
}

/** Emit canonical JSONL: one JCS claim per line, newline after every line. */
export function emitJsonl(claims: readonly Claim[]): { jsonl: string; jsonlSha256: string } {
  const preparedResult = prepareClaims([...claims]);
  if (!preparedResult.ok) {
    throw new Error(preparedResult.error.message);
  }
  return emitJsonlFromPrepared(preparedResult.value);
}
