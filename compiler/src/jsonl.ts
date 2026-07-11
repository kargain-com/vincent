import { canonicalize } from '@kargain/vincent/protocol';
import type { Claim } from '@kargain/vincent/protocol';

import { contentSha256 } from './hash-content.js';

/** Emit canonical JSONL: one JCS claim per line, newline after every line. */
export function emitJsonl(claims: readonly Claim[]): { jsonl: string; jsonlSha256: string } {
  const lines = claims.map((claim) => canonicalize(claim));
  const jsonl = lines.length === 0 ? '' : `${lines.join('\n')}\n`;
  return { jsonl, jsonlSha256: contentSha256(jsonl) };
}
