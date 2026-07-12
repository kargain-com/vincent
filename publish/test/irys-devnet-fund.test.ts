import { parseEther } from 'viem';
import { describe, expect, it, vi } from 'vitest';

import {
  fundIrysDevnetAccount,
  recoverIrysFundTransaction,
  submitIrysFundTransaction,
} from '../src/adapters/irys-devnet-fund.js';

function createMockIrysFundClient(options: {
  submitFund?: () => Promise<unknown>;
  createTx?: () => Promise<{ txId: string; tx: string }>;
  sendTx?: () => Promise<string>;
}) {
  const submitFundTransaction = vi.fn(options.submitFund ?? (async () => {}));
  const createTx = vi.fn(
    options.createTx ??
      (async () => ({
        txId: '0x1111111111111111111111111111111111111111111111111111111111111111',
        tx: '0xsigned',
      })),
  );
  const sendTx = vi.fn(options.sendTx ?? (async () => '0x1111111111111111111111111111111111111111111111111111111111111111'));

  return {
    token: 'base-eth',
    tokenConfig: {
      needsFee: true,
      getFee: vi.fn(async () => parseEther('0.0001')),
      createTx,
      sendTx,
    },
    utils: {
      getBundlerAddress: vi.fn(async () => '0x32ed3dc90cd5ae7b875a0ee7a86ca6d2fc72c635'),
    },
    funder: {
      submitFundTransaction,
    },
  };
}

describe('irys devnet fund', () => {
  it('retries bundler registration until it succeeds', async () => {
    const client = createMockIrysFundClient({
      submitFund: vi
        .fn()
        .mockRejectedValueOnce(new Error('400 Tx does not exist'))
        .mockResolvedValueOnce(undefined),
    });

    await submitIrysFundTransaction(client, '0xabc', { maxAttempts: 3 });

    expect(client.funder.submitFundTransaction).toHaveBeenCalledTimes(2);
  });

  it('waits for Sepolia confirmation before posting to the bundler', async () => {
    const client = createMockIrysFundClient({});
    const waitForTransactionReceipt = vi.fn(async () => ({ status: 'success' }));

    await fundIrysDevnetAccount(client, parseEther('0.01'), 'http://mock-sepolia', {
      waitForTransactionReceipt,
    });

    expect(client.tokenConfig.createTx).toHaveBeenCalled();
    expect(client.tokenConfig.sendTx).toHaveBeenCalled();
    expect(waitForTransactionReceipt).toHaveBeenCalled();
    expect(client.funder.submitFundTransaction).toHaveBeenCalledOnce();
  });

  it('registers an existing confirmed fund tx during recovery', async () => {
    const client = createMockIrysFundClient({});
    const waitForTransactionReceipt = vi.fn(async () => ({ status: 'success' }));
    const txId = '0x6033f736a080773131ff99939e1799f583b226dc69193d5ece67a79aafeadb3a';

    await recoverIrysFundTransaction(client, txId, 'http://mock-sepolia', {
      waitForTransactionReceipt,
    });

    expect(client.tokenConfig.createTx).not.toHaveBeenCalled();
    expect(waitForTransactionReceipt).toHaveBeenCalled();
    expect(client.funder.submitFundTransaction).toHaveBeenCalledWith(txId);
  });
});
