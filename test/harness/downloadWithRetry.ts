/**
 * Повтор сетевой операции с паузой между попытками.
 *
 * Зачем: e2e в CI падал не на тестах, а на скачивании VS Code — `@vscode/test-electron`
 * сдавался после первого таймаута, и прогон краснел, хотя к коду претензий нет.
 * Повтор с паузой снимает этот класс ложных падений.
 */
export interface RetryOptions {
  /** Сколько всего попыток, включая первую. Минимум 1 */
  attempts?: number;
  /** Пауза перед повтором, мс (умножается на номер попытки) */
  delayMs?: number;
  /** Вызывается перед повтором — чтобы в логе было видно, что попытка не первая */
  onRetry?: (error: unknown, attempt: number) => void;
  /** Повторять ли ошибку. По умолчанию — только временные сбои сети и сервера */
  isRetryable?: (error: unknown) => boolean;
  /** Пауза: подменяется в тестах, чтобы не ждать по-настоящему */
  sleep?: (ms: number) => Promise<void>;
}

/** Временные сбои: таймауты, обрывы, 5xx/429. 404 и авторизацию повторять бессмысленно. */
export function isTransientError(error: unknown): boolean {
  const message = String((error as { message?: string })?.message ?? error);
  if (/ETIMEDOUT|ECONNRESET|ECONNREFUSED|EAI_AGAIN|ENOTFOUND|socket hang up|timeout/i.test(message)) return true;
  if (/\b(429|500|502|503|504)\b/.test(message)) return true;
  return false;
}

const defaultSleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

export async function withRetry<T>(operation: () => Promise<T>, options: RetryOptions = {}): Promise<T> {
  const attempts = Math.max(1, options.attempts ?? 3);
  const delayMs = options.delayMs ?? 2_000;
  const sleep = options.sleep ?? defaultSleep;

  let lastError: unknown;
  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    try {
      return await operation();
    } catch (error) {
      lastError = error;
      const retryable = (options.isRetryable ?? isTransientError)(error);
      if (attempt === attempts || !retryable) break;
      options.onRetry?.(error, attempt);
      await sleep(delayMs * attempt);
    }
  }
  throw lastError;
}
