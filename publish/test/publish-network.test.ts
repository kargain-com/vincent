import { describe, expect, it } from 'vitest';

import { parseNetworkFlags } from '../src/cli/parse-network-flags.js';
import {
  BASE_MAINNET_CHAIN_ID,
  BASE_SEPOLIA_CHAIN_ID,
  DEFAULT_FULL_INDEX_CHECK_DELAY_MS,
  DEFAULT_MAINNET_FULL_INDEX_CHECK_DELAY_MS,
  DEFAULT_MAINNET_MAX_REUPLOAD_LEAVES,
  DEFAULT_MAINNET_POST_REUPLOAD_DELAY_MS,
  DEFAULT_POST_REUPLOAD_DELAY_MS,
  IRYS_GATEWAY_URL,
  IRYS_TESTNET_GATEWAY_URL,
} from '../src/constants.js';
import {
  resolveIndexCheckDefaults,
  resolveIrysGatewayUrl,
  resolvePublishNetwork,
} from '../src/publish-network.js';

describe('parseNetworkFlags', () => {
  it('accepts --network base-sepolia', () => {
    expect(parseNetworkFlags(['--network', 'base-sepolia'])).toBe('base-sepolia');
  });

  it('accepts --network=base', () => {
    expect(parseNetworkFlags(['--network=base'])).toBe('base');
  });

  it('accepts --devnet alias', () => {
    expect(parseNetworkFlags(['--devnet', '--full'])).toBe('base-sepolia');
  });

  it('accepts --mainnet alias', () => {
    expect(parseNetworkFlags(['--mainnet'])).toBe('base');
  });

  it('rejects conflicting network flags', () => {
    expect(() => parseNetworkFlags(['--devnet', '--mainnet'])).toThrow(/mutually exclusive/);
    expect(() => parseNetworkFlags(['--network=base', '--devnet'])).toThrow(/conflicts/);
  });

  it('requires an explicit network', () => {
    expect(() => parseNetworkFlags(['--full'])).toThrow(/Network required/);
  });
});

describe('resolvePublishNetwork', () => {
  it('maps base-sepolia to Sepolia chain id and gateway', () => {
    const profile = resolvePublishNetwork('base-sepolia');
    expect(profile.chainId).toBe(BASE_SEPOLIA_CHAIN_ID);
    expect(profile.rpcEnvVar).toBe('BASE_SEPOLIA_RPC_URL');
    expect(profile.defaultGatewayUrl).toBe(IRYS_TESTNET_GATEWAY_URL);
    expect(profile.indexCheck.reuploadOnFailureDefault).toBe(true);
  });

  it('maps base mainnet profile', () => {
    const profile = resolvePublishNetwork('base');
    expect(profile.chainId).toBe(BASE_MAINNET_CHAIN_ID);
    expect(profile.rpcEnvVar).toBe('BASE_MAINNET_RPC_URL');
    expect(profile.defaultGatewayUrl).toBe(IRYS_GATEWAY_URL);
    expect(profile.indexCheck.reuploadOnFailureDefault).toBe(false);
  });
});

describe('resolveIrysGatewayUrl', () => {
  it('uses env override when provided', () => {
    expect(resolveIrysGatewayUrl(BASE_SEPOLIA_CHAIN_ID, 'https://custom.example/')).toBe(
      'https://custom.example/',
    );
  });

  it('defaults by chain id', () => {
    expect(resolveIrysGatewayUrl(BASE_SEPOLIA_CHAIN_ID)).toBe(IRYS_TESTNET_GATEWAY_URL);
    expect(resolveIrysGatewayUrl(BASE_MAINNET_CHAIN_ID)).toBe(IRYS_GATEWAY_URL);
  });
});

describe('resolveIndexCheckDefaults', () => {
  const sepolia = resolvePublishNetwork('base-sepolia');
  const mainnet = resolvePublishNetwork('base');

  it('uses testnet timing for full publish', () => {
    const defaults = resolveIndexCheckDefaults(sepolia, 'full', false, {});
    expect(defaults.delayMs).toBe(DEFAULT_FULL_INDEX_CHECK_DELAY_MS);
    expect(defaults.postReuploadDelayMs).toBe(DEFAULT_POST_REUPLOAD_DELAY_MS);
    expect(defaults.reuploadOnFailure).toBe(true);
    expect(defaults.maxReuploadLeaves).toBeUndefined();
  });

  it('uses mainnet timing and disables re-upload by default', () => {
    const defaults = resolveIndexCheckDefaults(mainnet, 'full', false, {});
    expect(defaults.delayMs).toBe(DEFAULT_MAINNET_FULL_INDEX_CHECK_DELAY_MS);
    expect(defaults.postReuploadDelayMs).toBe(DEFAULT_MAINNET_POST_REUPLOAD_DELAY_MS);
    expect(defaults.reuploadOnFailure).toBe(false);
    expect(defaults.maxReuploadLeaves).toBe(0);
  });

  it('caps mainnet full re-uploads when --allow-reupload', () => {
    const defaults = resolveIndexCheckDefaults(mainnet, 'full', false, {
      allowReupload: true,
    });
    expect(defaults.reuploadOnFailure).toBe(true);
    expect(defaults.maxReuploadLeaves).toBe(DEFAULT_MAINNET_MAX_REUPLOAD_LEAVES);
  });
});
