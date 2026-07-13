import { describe, expect, it } from 'vitest';

import * as backfillModule from '../src/backfill-leaf-uris.js';
import * as chainModule from '../src/adapters/base-sepolia-publisher.js';
import * as checkpointModule from '../src/publish-checkpoint.js';
import * as constantsModule from '../src/constants.js';
import * as registryModule from '../src/adapters/registry-publisher.js';
import * as publishEntry from '../src/index.js';
import * as verifyGenesisModule from '../src/verify-genesis-publish.js';
import * as verifyLeavesModule from '../src/verify-uploaded-leaves.js';

describe('publish entry re-exports', () => {
  it('exposes checkpoint helpers from the package root', () => {
    expect(publishEntry.CHECKPOINT_SCHEMA_VERSION).toBe(checkpointModule.CHECKPOINT_SCHEMA_VERSION);
    expect(typeof publishEntry.createEmptyCheckpoint).toBe('function');
    expect(typeof publishEntry.loadCheckpoint).toBe('function');
    expect(typeof publishEntry.loadOrCreateCheckpoint).toBe('function');
    expect(typeof publishEntry.saveCheckpoint).toBe('function');
    expect(publishEntry.markLeafUploaded).toBe(checkpointModule.markLeafUploaded);
    expect(publishEntry.mergeLeafUris).toBe(checkpointModule.mergeLeafUris);
    expect(publishEntry.needsLeafUriBackfillHint).toBe(checkpointModule.needsLeafUriBackfillHint);
    expect(publishEntry.formatLeafUriBackfillHint).toBe(checkpointModule.formatLeafUriBackfillHint);
    expect(publishEntry.writeLeafUriBackfillHintIfNeeded).toBe(
      checkpointModule.writeLeafUriBackfillHintIfNeeded,
    );
  });

  it('exposes verification and backfill APIs from the package root', () => {
    expect(typeof publishEntry.verifyGenesisPublish).toBe('function');
    expect(typeof publishEntry.verifyUploadedLeaves).toBe('function');
    expect(publishEntry.verifyGenesisPublish).toBe(verifyGenesisModule.verifyGenesisPublish);
    expect(publishEntry.verifyUploadedLeaves).toBe(verifyLeavesModule.verifyUploadedLeaves);
    expect(publishEntry.backfillLeafUrisFromGraphql).toBe(
      backfillModule.backfillLeafUrisFromGraphql,
    );
  });

  it('exposes Base Sepolia adapters from the package root', () => {
    expect(typeof publishEntry.createBaseSepoliaPublisher).toBe('function');
    expect(typeof publishEntry.createBaseSepoliaReader).toBe('function');
    expect(publishEntry.createBaseSepoliaPublisher).toBe(chainModule.createBaseSepoliaPublisher);
    expect(publishEntry.createBaseSepoliaReader).toBe(chainModule.createBaseSepoliaReader);
  });

  it('exposes generic registry adapters from the package root', () => {
    expect(typeof publishEntry.createRegistryPublisher).toBe('function');
    expect(typeof publishEntry.createRegistryReader).toBe('function');
    expect(publishEntry.createRegistryPublisher).toBe(registryModule.createRegistryPublisher);
    expect(publishEntry.createRegistryReader).toBe(registryModule.createRegistryReader);
  });

  it('exposes mainnet network constants from the package root', () => {
    expect(publishEntry.resolveIrysBundlerUrl).toBe(constantsModule.resolveIrysBundlerUrl);
    expect(publishEntry.BASE_MAINNET_CHAIN_ID).toBe(8453);
  });

  it('exposes unified Irys uploader from the package root', () => {
    expect(typeof publishEntry.createIrysUploader).toBe('function');
    expect(typeof publishEntry.createIrysClient).toBe('function');
    expect(typeof publishEntry.resolvePublishNetwork).toBe('function');
  });
});
