import { compile } from '@kargain/vincent-compiler';
import { describe, expect, it } from 'vitest';

import {
  fetchLeafFromGateway,
  verifyLeafFromGateway,
} from '../src/fetch-leaf-from-gateway.js';
import { loadGenesisMiniClaims } from './helpers.js';
import { createMockGateway, type MockGatewayItem } from './mock-gateway.js';

function buildGatewayItems(): { items: MockGatewayItem[]; merkleRoot: string } {
  const built = compile(loadGenesisMiniClaims(), {});
  if (!built.ok) {
    throw new Error(built.error.message);
  }
  const items = [...built.value.leaves.entries()].map(([leafKey, entry], index) => ({
    owner: '0xowner',
    epoch: 1,
    leafKey,
    txId: `tx-${leafKey}`,
    height: index + 1,
    data: { leaf: entry.leaf, proof: entry.proof },
  }));
  return { items, merkleRoot: built.value.merkleRoot };
}

describe('fetchLeafFromGateway', () => {
  it('fetches a leaf payload by tx id and by ar:// URI', async () => {
    const { items } = buildGatewayItems();
    const { gatewayUrl, fetchImpl } = createMockGateway(items);
    const first = items[0];

    const byTxId = await fetchLeafFromGateway(gatewayUrl, first.txId, fetchImpl);
    expect(byTxId.leaf).toBe(first.data.leaf);

    const byUri = await fetchLeafFromGateway(gatewayUrl, `ar://${first.txId}`, fetchImpl);
    expect(byUri.leaf).toBe(first.data.leaf);
  });

  it('throws when the gateway responds with an error status', async () => {
    const { items } = buildGatewayItems();
    const { gatewayUrl, fetchImpl } = createMockGateway(items);

    await expect(fetchLeafFromGateway(gatewayUrl, 'tx-missing', fetchImpl)).rejects.toThrow(
      /Gateway returned 404/,
    );
  });
});

describe('verifyLeafFromGateway', () => {
  it('returns true for a valid leaf and proof', async () => {
    const { items, merkleRoot } = buildGatewayItems();
    const { gatewayUrl, fetchImpl } = createMockGateway(items);

    await expect(
      verifyLeafFromGateway({
        gatewayUrl,
        txIdOrUri: items[0].txId,
        merkleRoot,
        fetchImpl,
      }),
    ).resolves.toBe(true);
  });

  it('returns false when the leaf is missing or the proof does not match', async () => {
    const { items, merkleRoot } = buildGatewayItems();
    const { gatewayUrl, fetchImpl } = createMockGateway(items);

    await expect(
      verifyLeafFromGateway({
        gatewayUrl,
        txIdOrUri: 'tx-missing',
        merkleRoot,
        fetchImpl,
      }),
    ).resolves.toBe(false);

    await expect(
      verifyLeafFromGateway({
        gatewayUrl,
        txIdOrUri: items[0].txId,
        merkleRoot: 'sha256:' + 'f'.repeat(64),
        fetchImpl,
      }),
    ).resolves.toBe(false);
  });
});
