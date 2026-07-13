import { describe, expect, it, vi } from 'vitest';

import {
  irysUploadRetryDelayMs,
  isRetryableIrysUploadError,
  withIrysUploadRetries,
} from '../src/adapters/irys-upload-retry.js';

describe('isRetryableIrysUploadError', () => {
  it('treats ETIMEDOUT and transient HTTP statuses as retryable', () => {
    expect(isRetryableIrysUploadError({ code: 'ETIMEDOUT' })).toBe(true);
    expect(isRetryableIrysUploadError(new Error('read ETIMEDOUT'))).toBe(true);
    expect(isRetryableIrysUploadError({ response: { status: 503 } })).toBe(true);
  });

  it('does not retry permanent client errors', () => {
    expect(isRetryableIrysUploadError({ response: { status: 402 } })).toBe(false);
    expect(isRetryableIrysUploadError(new Error('invalid tags'))).toBe(false);
  });
});

describe('withIrysUploadRetries', () => {
  it('retries transient failures and eventually succeeds', async () => {
    const operation = vi
      .fn()
      .mockRejectedValueOnce(new Error('read ETIMEDOUT'))
      .mockResolvedValueOnce({ id: 'tx-2' });
    const sleep = vi.fn().mockResolvedValue(undefined);
    const onRetry = vi.fn();

    await expect(
      withIrysUploadRetries(operation, {
        maxAttempts: 3,
        sleep,
        onRetry,
      }),
    ).resolves.toEqual({ id: 'tx-2' });

    expect(operation).toHaveBeenCalledTimes(2);
    expect(sleep).toHaveBeenCalledWith(irysUploadRetryDelayMs(1));
    expect(onRetry).toHaveBeenCalledOnce();
  });

  it('does not retry non-transient failures', async () => {
    const operation = vi.fn().mockRejectedValue(new Error('402 Not enough balance'));
    const sleep = vi.fn().mockResolvedValue(undefined);

    await expect(
      withIrysUploadRetries(operation, {
        maxAttempts: 3,
        sleep,
      }),
    ).rejects.toThrow('402 Not enough balance');

    expect(operation).toHaveBeenCalledOnce();
    expect(sleep).not.toHaveBeenCalled();
  });
});
