import { existsSync } from 'node:fs';

import { compile } from '@kargain/vincent-compiler';
import { expect, test } from 'vitest';

import { FULL_SEED_PATH, loadFullSeedClaims } from '../src/load-full-seed-claims.js';
import { publishGenesis } from '../src/publish-genesis.js';
import { loadSeedFixtureCases } from '../src/seed-fixtures.js';
import { verifyGenesisPublish } from '../src/verify-genesis-publish.js';
import { getLocalChainHarness } from './local-chain-harness.js';
import { createMockIrysGateway } from './mock-irys-gateway.js';
import { createMockUploader } from './mock-uploader.js';
import { mockPreflightOverrides } from './simulate-genesis-publish.js';
import { testCheckpointPath } from './helpers.js';

test(
  'full seed publishes locally and decodes all 20 committed VIN fixtures',
  async () => {
    if (!existsSync(FULL_SEED_PATH)) {
      throw new Error(`Full seed not found at ${FULL_SEED_PATH}; run pnpm generate:seed`);
    }

    const harness = await getLocalChainHarness();
    const account = harness.getAccount(19);
    const chainPublisher = harness.createPublisher(19);
    const claims = await loadFullSeedClaims();
    const built = compile(claims, {});
    if (!built.ok) {
      throw new Error(built.error.message);
    }

    const uploader = createMockUploader();
    const report = await publishGenesis({
      epoch: built.value,
      signerKeyHex: account.privateKeyHex,
      uploader,
      chainPublisher,
      checkpointPath: testCheckpointPath(),
      preflight: mockPreflightOverrides(),
    });

    const gateway = createMockIrysGateway(uploader.records, account.address, 1);
    const verification = await verifyGenesisPublish({
      report,
      chainPublisher,
      gatewayUrl: gateway.gatewayUrl,
      graphqlUrl: gateway.graphqlUrl,
      fixture: 'full',
      fetchImpl: gateway.fetchImpl,
    });

    expect(loadSeedFixtureCases()).toHaveLength(20);
    expect(uploader.records).toHaveLength(built.value.leaves.size + 2);
    expect(verification).toEqual({ ok: true, failures: [] });
    expect(await chainPublisher.readEpochCount(account.address)).toBe(1n);
  },
  180_000,
);
