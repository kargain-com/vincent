import type { PublishEpochArgs } from '../src/adapters/types.js';
import { ZERO_BYTES32 } from '../src/adapters/sha256-bytes32.js';

const ROOT_1 = `0x${'1'.repeat(64)}` as const;
const ROOT_2 = `0x${'2'.repeat(64)}` as const;
const JSONL_1 = `0x${'3'.repeat(64)}` as const;
const JSONL_2 = `0x${'4'.repeat(64)}` as const;
const MANIFEST_1 = `0x${'5'.repeat(64)}` as const;
const MANIFEST_2 = `0x${'6'.repeat(64)}` as const;

export interface ChainScenarioStep {
  args: PublishEpochArgs;
  error?: string;
}

export interface ChainPublisherScenario {
  name: string;
  steps: readonly ChainScenarioStep[];
}

const genesis: PublishEpochArgs = {
  merkleRoot: ROOT_1,
  jsonlSha256: JSONL_1,
  manifestHash: MANIFEST_1,
  parentRoot: ZERO_BYTES32,
  manifestUri: 'ar://genesis',
};

const epoch2: PublishEpochArgs = {
  merkleRoot: ROOT_2,
  jsonlSha256: JSONL_2,
  manifestHash: MANIFEST_2,
  parentRoot: ROOT_1,
  manifestUri: 'ar://epoch-2',
};

export const CHAIN_PUBLISHER_SCENARIOS: readonly ChainPublisherScenario[] = [
  { name: 'genesis succeeds', steps: [{ args: genesis }] },
  {
    name: 'genesis with non-zero parentRoot reverts',
    steps: [
      {
        args: { ...genesis, parentRoot: ROOT_2 },
        error: 'genesis parentRoot must be zero',
      },
    ],
  },
  {
    name: 'second publish with wrong parentRoot reverts',
    steps: [
      { args: genesis },
      {
        args: { ...epoch2, parentRoot: ROOT_2 },
        error: 'parentRoot mismatch',
      },
    ],
  },
  {
    name: 'second publish with prior merkleRoot succeeds',
    steps: [{ args: genesis }, { args: epoch2 }],
  },
  {
    name: 'zero merkleRoot reverts',
    steps: [
      {
        args: { ...genesis, merkleRoot: ZERO_BYTES32 },
        error: 'merkleRoot must be non-zero',
      },
    ],
  },
  {
    name: 'zero jsonlSha256 reverts',
    steps: [
      {
        args: { ...genesis, jsonlSha256: ZERO_BYTES32 },
        error: 'jsonlSha256 must be non-zero',
      },
    ],
  },
  {
    name: 'zero manifestHash reverts',
    steps: [
      {
        args: { ...genesis, manifestHash: ZERO_BYTES32 },
        error: 'manifestHash must be non-zero',
      },
    ],
  },
  {
    name: 'empty manifestUri reverts',
    steps: [
      {
        args: { ...genesis, manifestUri: '' },
        error: 'invalid manifestUri length',
      },
    ],
  },
  {
    name: 'oversized manifestUri reverts',
    steps: [
      {
        args: { ...genesis, manifestUri: 'x'.repeat(257) },
        error: 'invalid manifestUri length',
      },
    ],
  },
  {
    name: '256-byte manifestUri succeeds',
    steps: [{ args: { ...genesis, manifestUri: 'x'.repeat(256) } }],
  },
];
