export interface RetryConfig {
  maxRetries: number;
  initialDelayMs: number;
  maxDelayMs: number;
}

export const DEFAULT_RETRY: RetryConfig = {
  maxRetries: 3,
  initialDelayMs: 1000,
  maxDelayMs: 30_000,
};

export function computeBackoffMs(attempt: number, config: RetryConfig): number {
  const exponential = config.initialDelayMs * Math.pow(2, attempt);
  const capped = Math.min(exponential, config.maxDelayMs);
  return Math.floor(Math.random() * capped);
}

export async function withRetry<T>(
  fn: (attempt: number) => Promise<T>,
  config: Partial<RetryConfig> = {},
  onRetry?: (attempt: number, error: Error) => void,
): Promise<T> {
  const cfg: RetryConfig = {...DEFAULT_RETRY, ...config};

  let lastError: Error;
  for (let attempt = 0; attempt <= cfg.maxRetries; attempt++) {
    try {
      return await fn(attempt);
    } catch (err) {
      lastError = err instanceof Error ? err : new Error(String(err));
      if (attempt < cfg.maxRetries) {
        onRetry?.(attempt + 1, lastError);
        const delay = computeBackoffMs(attempt, cfg);
        await sleep(delay);
      }
    }
  }

  throw lastError!;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
