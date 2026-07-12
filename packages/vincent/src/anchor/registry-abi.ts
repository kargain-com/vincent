import type { Abi } from 'viem';

const EPOCH_COMPONENTS = [
  { name: 'merkleRoot', type: 'bytes32' },
  { name: 'jsonlSha256', type: 'bytes32' },
  { name: 'manifestHash', type: 'bytes32' },
  { name: 'parentRoot', type: 'bytes32' },
  { name: 'timestamp', type: 'uint64' },
  { name: 'manifestUri', type: 'string' },
] as const;

/** Read-only VincentAnchorRegistry ABI for epoch queries. */
export const REGISTRY_ABI = [
  {
    type: 'function',
    name: 'epochCount',
    stateMutability: 'view',
    inputs: [{ name: 'publisher', type: 'address' }],
    outputs: [{ name: 'count', type: 'uint256' }],
  },
  {
    type: 'function',
    name: 'getEpoch',
    stateMutability: 'view',
    inputs: [
      { name: 'publisher', type: 'address' },
      { name: 'index', type: 'uint256' },
    ],
    outputs: [
      {
        name: 'epoch',
        type: 'tuple',
        components: EPOCH_COMPONENTS,
      },
    ],
  },
  {
    type: 'function',
    name: 'latestEpoch',
    stateMutability: 'view',
    inputs: [{ name: 'publisher', type: 'address' }],
    outputs: [
      {
        name: 'epoch',
        type: 'tuple',
        components: EPOCH_COMPONENTS,
      },
    ],
  },
] as const satisfies Abi;
