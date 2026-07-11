import { createReadStream } from 'node:fs';
import { createInterface } from 'node:readline';

import { compile } from '@kargain/vincent-compiler';
import type { EpochBuild } from '@kargain/vincent-compiler';
import { createDecoder } from '@kargain/vincent/decoder';
import type { Decoder } from '@kargain/vincent/decoder';
import { parseClaim } from '@kargain/vincent/protocol';
import type { Claim } from '@kargain/vincent/protocol';

import { progress } from '../generate-wmi-internals.js';
import { SEED_JSONL_PATH } from '../vpic/source.js';

export async function loadSeedClaims(path: string = SEED_JSONL_PATH): Promise<Claim[]> {
  progress(`Loading seed claims from ${path}...`);
  const claims: Claim[] = [];
  const rl = createInterface({
    input: createReadStream(path, { encoding: 'utf8' }),
    crlfDelay: Infinity,
  });

  let lineNo = 0;
  for await (const line of rl) {
    if (line.length === 0) {
      continue;
    }
    lineNo += 1;
    const parsed = parseClaim(JSON.parse(line) as unknown);
    if (!parsed.ok) {
      throw new Error(`Invalid claim at line ${String(lineNo)}: ${parsed.error.message}`);
    }
    claims.push(parsed.value);
    if (lineNo % 100_000 === 0) {
      progress(`  parsed ${String(lineNo)} claims...`);
    }
  }

  progress(`Loaded ${String(claims.length)} claims`);
  return claims;
}

export interface SeedDecoderBundle {
  decoder: Decoder;
  epoch: EpochBuild;
}

export function buildSeedDecoder(claims: readonly Claim[]): SeedDecoderBundle {
  progress(`Compiling ${String(claims.length)} claims...`);
  const built = compile([...claims], { progress });
  if (!built.ok) {
    throw new Error(`compile failed: ${built.error.message}`);
  }
  progress('Compile complete; creating decoder...');
  const epoch = built.value;
  const decoder = createDecoder({
    merkleRoot: epoch.merkleRoot,
    getLeaf: (wmi) => {
      const entry = epoch.leaves.get(wmi);
      if (entry === undefined) {
        return Promise.reject(new Error(`missing leaf for ${wmi}`));
      }
      return Promise.resolve({ leaf: entry.leaf, proof: entry.proof });
    },
  });
  return { decoder, epoch };
}
