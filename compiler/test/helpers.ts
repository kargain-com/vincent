import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import type { Claim } from '@kargain/vincent/protocol';

const FIXTURE_DIR = join(dirname(fileURLToPath(import.meta.url)), '../fixtures/genesis-mini');

export function loadGenesisMiniClaims(): Claim[] {
  return JSON.parse(readFileSync(join(FIXTURE_DIR, 'claims.json'), 'utf8')) as Claim[];
}

export function loadGenesisMiniGolden(): { jsonlSha256: string } {
  return JSON.parse(readFileSync(join(FIXTURE_DIR, 'golden.json'), 'utf8')) as {
    jsonlSha256: string;
  };
}

export const TEST_PRIVATE_KEY =
  '0xac0974bec39a17e36ba4a6b4d238ff944bacb478cab039431e99c5825582831';
