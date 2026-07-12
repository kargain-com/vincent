import { createReadStream } from 'node:fs';
import { dirname, join } from 'node:path';
import { createInterface } from 'node:readline';
import { fileURLToPath } from 'node:url';

import { parseClaim, type Claim } from '@kargain/vincent/protocol';

export const FULL_SEED_PATH = join(
  dirname(fileURLToPath(import.meta.url)),
  '../../pipeline/.build/genesis-seed.jsonl',
);

export async function loadFullSeedClaims(): Promise<Claim[]> {
  const claims: Claim[] = [];
  const lines = createInterface({
    input: createReadStream(FULL_SEED_PATH, { encoding: 'utf8' }),
    crlfDelay: Infinity,
  });

  let lineNo = 0;
  for await (const line of lines) {
    if (line.length === 0) {
      continue;
    }
    lineNo += 1;
    const parsed = parseClaim(JSON.parse(line) as unknown);
    if (!parsed.ok) {
      throw new Error(`Invalid claim at line ${String(lineNo)}: ${parsed.error.message}`);
    }
    claims.push(parsed.value);
  }

  return claims;
}
