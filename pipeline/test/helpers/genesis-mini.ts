import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { compile } from '@kargain/vincent-compiler';
import type { EpochBuild } from '@kargain/vincent-compiler';
import { createDecoder } from '@kargain/vincent/decoder';
import type { Decoder } from '@kargain/vincent/decoder';
import type { Claim } from '@kargain/vincent/protocol';
import { validateVin } from '@kargain/vincent';

const FIXTURE_DIR = join(
  dirname(fileURLToPath(import.meta.url)),
  '../../../compiler/fixtures/genesis-mini',
);

export function loadGenesisMiniClaims(): Claim[] {
  return JSON.parse(readFileSync(join(FIXTURE_DIR, 'claims.json'), 'utf8')) as Claim[];
}

export function loadGenesisMiniGolden(): {
  jsonlSha256: string;
  merkleRoot: string;
  sampleLeafWmi: string;
  sampleLeafHash: string;
} {
  return JSON.parse(readFileSync(join(FIXTURE_DIR, 'golden.json'), 'utf8')) as {
    jsonlSha256: string;
    merkleRoot: string;
    sampleLeafWmi: string;
    sampleLeafHash: string;
  };
}

export function compileGenesisMini(): EpochBuild {
  const built = compile(loadGenesisMiniClaims(), {});
  if (!built.ok) {
    throw new Error(built.error.message);
  }
  return built.value;
}

const CHECK_DIGIT_ALPHABET = '0123456789ABCDEFGHJKLMNPRSTUVWXYZ';

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

export const GENESIS_MINI_VIN_2011 = withValidCheckDigit('1FA12BB00BG123456');

export function buildGenesisMiniDecoder(epoch: EpochBuild): Decoder {
  return createDecoder({
    merkleRoot: epoch.merkleRoot,
    getLeaf: (wmi) => {
      const entry = epoch.leaves.get(wmi);
      if (entry === undefined) {
        return Promise.reject(new Error(`missing leaf for ${wmi}`));
      }
      return Promise.resolve({ leaf: entry.leaf, proof: entry.proof });
    },
  });
}
