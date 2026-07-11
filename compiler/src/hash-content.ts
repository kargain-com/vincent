import { sha256Hex } from '@kargain/vincent/protocol';

function utf8Bytes(value: string): Uint8Array {
  return new TextEncoder().encode(value);
}

/** SHA-256 content id with sha256: prefix (§3). */
export function contentSha256(content: string | Uint8Array): string {
  const bytes = typeof content === 'string' ? utf8Bytes(content) : content;
  return `sha256:${sha256Hex(bytes)}`;
}
