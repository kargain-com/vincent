import type { CompilePolicy } from '@kargain/vincent-compiler';
import { compile } from '@kargain/vincent-compiler';
import type { EpochBuild } from '@kargain/vincent-compiler';
import type { Claim } from '@kargain/vincent/protocol';

import { createDecoder } from '../../src/decoder/create-decoder.js';
import type { Decoder } from '../../src/decoder/types.js';

export function compileEpoch(claims: Claim[], policy: CompilePolicy = {}): EpochBuild {
  const built = compile(claims, policy);
  if (!built.ok) {
    throw new Error(built.error.message);
  }
  return built.value;
}

export function buildDecoderFromEpoch(epoch: EpochBuild): Decoder {
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

export function buildDecoderFromClaims(claims: Claim[]): Decoder {
  return buildDecoderFromEpoch(compileEpoch(claims));
}
