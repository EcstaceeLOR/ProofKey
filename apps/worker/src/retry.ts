export class PermanentRelayError extends Error {
  override readonly name = 'PermanentRelayError';
}

export interface RetryOptions {
  maxAttempts: number;
  baseDelayMs: number;
  onAttempt?: (attempt: number) => void;
  sleep?: (milliseconds: number) => Promise<void>;
}

const defaultSleep = (milliseconds: number): Promise<void> =>
  new Promise((resolve) => setTimeout(resolve, milliseconds));

export async function withRetry<T>(
  operation: () => Promise<T>,
  options: RetryOptions,
): Promise<T> {
  if (!Number.isInteger(options.maxAttempts) || options.maxAttempts < 1) {
    throw new Error('maxAttempts must be a positive integer');
  }
  let lastError: unknown;
  for (let attempt = 1; attempt <= options.maxAttempts; attempt += 1) {
    options.onAttempt?.(attempt);
    try {
      return await operation();
    } catch (error) {
      if (error instanceof PermanentRelayError) throw error;
      lastError = error;
      if (attempt < options.maxAttempts) {
        await (options.sleep ?? defaultSleep)(
          options.baseDelayMs * 2 ** (attempt - 1),
        );
      }
    }
  }
  throw lastError instanceof Error ? lastError : new Error(String(lastError));
}
