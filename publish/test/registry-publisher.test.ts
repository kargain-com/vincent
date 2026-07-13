import { describe, expect, it } from 'vitest';

import { ZERO_BYTES32 } from '../src/adapters/sha256-bytes32.js';
import { getLocalChainHarness } from './local-chain-harness.js';

const GENESIS_ARGS = {
  merkleRoot: `0x${'1'.repeat(64)}`,
  jsonlSha256: `0x${'3'.repeat(64)}`,
  manifestHash: `0x${'5'.repeat(64)}`,
  parentRoot: ZERO_BYTES32,
  manifestUri: 'ar://registry-genesis',
} as const;

describe('createRegistryPublisher', () => {
  it('publishes a genesis epoch on a custom chain', async () => {
    const harness = await getLocalChainHarness();
    const account = harness.getAccount(18);
    const registryPublisher = harness.createRegistryPublisher(18);

    await registryPublisher.publishEpoch(GENESIS_ARGS);
    expect(await registryPublisher.readEpochCount(account.address)).toBe(1n);

    const latest = await registryPublisher.readLatestEpoch(account.address);
    expect(latest.manifestUri).toBe('ar://registry-genesis');
  });

  it('matches createBaseSepoliaPublisher when both use the same chain', async () => {
    const harness = await getLocalChainHarness();
    const account = harness.getAccount(19);
    const registryPublisher = harness.createRegistryPublisher(19);
    const sepoliaPublisher = harness.createPublisher(19);

    expect(registryPublisher).not.toBe(sepoliaPublisher);

    await registryPublisher.publishEpoch(GENESIS_ARGS);
    expect(await sepoliaPublisher.readEpochCount(account.address)).toBe(1n);
    expect((await sepoliaPublisher.readLatestEpoch(account.address)).manifestUri).toBe(
      'ar://registry-genesis',
    );
  });
});
