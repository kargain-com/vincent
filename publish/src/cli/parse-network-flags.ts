import type { PublishNetworkId } from '../publish-network.js';

const NETWORK_USAGE =
  'Network required: --network base-sepolia|base, or alias --devnet / --mainnet';

function parseNetworkValue(value: string): PublishNetworkId {
  if (value === 'base-sepolia' || value === 'base') {
    return value;
  }
  throw new Error('--network must be base-sepolia or base');
}

export function parseNetworkFlags(argv: string[]): PublishNetworkId {
  const hasDevnet = argv.includes('--devnet');
  const hasMainnet = argv.includes('--mainnet');
  if (hasDevnet && hasMainnet) {
    throw new Error('--devnet and --mainnet are mutually exclusive');
  }
  const networkArg = argv.find((arg) => arg.startsWith('--network='));
  const networkFlagIndex = argv.indexOf('--network');
  let networkFromFlag: PublishNetworkId | undefined;

  if (networkArg !== undefined) {
    networkFromFlag = parseNetworkValue(networkArg.slice('--network='.length));
  } else if (networkFlagIndex >= 0) {
    const value = argv[networkFlagIndex + 1];
    if (value === undefined) {
      throw new Error(`${NETWORK_USAGE}`);
    }
    networkFromFlag = parseNetworkValue(value);
  }

  const aliasNetwork: PublishNetworkId | undefined = hasDevnet
    ? 'base-sepolia'
    : hasMainnet
      ? 'base'
      : undefined;

  if (networkFromFlag !== undefined && aliasNetwork !== undefined) {
    if (networkFromFlag !== aliasNetwork) {
      throw new Error('--network conflicts with --devnet / --mainnet');
    }
  }

  const network = networkFromFlag ?? aliasNetwork;
  if (network === undefined) {
    throw new Error(NETWORK_USAGE);
  }

  return network;
}
