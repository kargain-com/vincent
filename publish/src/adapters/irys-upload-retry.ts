const RETRYABLE_ERROR_CODES = new Set([
  'ETIMEDOUT',
  'ECONNRESET',
  'ECONNABORTED',
  'ENOTFOUND',
  'EAI_AGAIN',
  'ENETUNREACH',
]);

const RETRYABLE_HTTP_STATUSES = new Set([408, 429, 502, 503, 504]);

const RETRYABLE_MESSAGE_RE =
  /\b(ETIMEDOUT|ECONNRESET|ECONNABORTED|ENOTFOUND|EAI_AGAIN|ENETUNREACH|network|socket hang up|timeout)\b/i;

const UPLOAD_RETRY_BASE_MS = 2_000;
const UPLOAD_RETRY_MAX_MS = 30_000;

function readErrorCode(error: unknown): string | undefined {
  if (!error || typeof error !== 'object') {
    return undefined;
  }
  const code = (error as { code?: unknown }).code;
  return typeof code === 'string' ? code : undefined;
}

function readErrorMessage(error: unknown): string {
  if (error instanceof Error) {
    return error.message;
  }
  if (typeof error === 'string') {
    return error;
  }
  return String(error);
}

function readHttpStatus(error: unknown): number | undefined {
  if (!error || typeof error !== 'object') {
    return undefined;
  }
  const response = (error as { response?: { status?: unknown } }).response;
  const status = response?.status;
  return typeof status === 'number' ? status : undefined;
}

/** Whether an Irys upload error is likely transient and worth retrying. */
export function isRetryableIrysUploadError(error: unknown): boolean {
  const code = readErrorCode(error);
  if (code !== undefined && RETRYABLE_ERROR_CODES.has(code)) {
    return true;
  }

  const status = readHttpStatus(error);
  if (status !== undefined && RETRYABLE_HTTP_STATUSES.has(status)) {
    return true;
  }

  return RETRYABLE_MESSAGE_RE.test(readErrorMessage(error));
}

export function irysUploadRetryDelayMs(attempt: number): number {
  return Math.min(UPLOAD_RETRY_BASE_MS * attempt, UPLOAD_RETRY_MAX_MS);
}

export interface IrysUploadRetryOptions {
  maxAttempts: number;
  onRetry?: (info: { attempt: number; maxAttempts: number; error: unknown }) => void;
  sleep?: (ms: number) => Promise<void>;
}

export async function withIrysUploadRetries<T>(
  operation: () => Promise<T>,
  options: IrysUploadRetryOptions,
): Promise<T> {
  const sleep = options.sleep ?? ((ms: number) => new Promise((resolve) => setTimeout(resolve, ms)));
  let lastError: unknown;

  for (let attempt = 1; attempt <= options.maxAttempts; attempt += 1) {
    try {
      return await operation();
    } catch (error) {
      lastError = error;
      if (attempt >= options.maxAttempts || !isRetryableIrysUploadError(error)) {
        throw error;
      }
      options.onRetry?.({ attempt, maxAttempts: options.maxAttempts, error });
      await sleep(irysUploadRetryDelayMs(attempt));
    }
  }

  throw lastError instanceof Error ? lastError : new Error('Irys upload failed after retries');
}
