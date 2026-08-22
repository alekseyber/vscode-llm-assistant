// RetryHandler — обёртка с exponential backoff для API-вызовов к LLM
// Обрабатывает 429, 5xx, network errors. Не ретраит на 400, 401, 403, 404.
// Добавляет jitter (±25%) и таймаут на каждый запрос.

/**
 * Тип колбэка для оповещения о ретрае (для WebView индикации).
 * @param attempt — номер текущей попытки (1-based, где 1 = первый ретрай)
 * @param maxRetries — максимальное количество ретраев
 * @param delayMs — задержка перед следующей попыткой в мс
 * @param errorMsg — текст ошибки, вызвавшей ретрай
 */
export type RetryCallback = (
  attempt: number,
  maxRetries: number,
  delayMs: number,
  errorMsg: string
) => void;

/**
 * Настройки ретрая.
 */
export interface RetryOptions {
  /** Максимальное количество повторных попыток (по умолчанию 3) */
  maxRetries?: number;
  /** Базовая задержка между попытками в мс (по умолчанию 1000) */
  baseDelayMs?: number;
  /** Максимальная задержка в мс (по умолчанию 8000) */
  maxDelayMs?: number;
  /** HTTP-коды, при которых выполняем ретрай (по умолчанию [429, 500, 502, 503, 504]) */
  retryOn?: number[];
  /** Колбэк для оповещения о ретрае */
  onRetry?: RetryCallback;
  /** Сигнал отмены (от пользователя) */
  signal?: AbortSignal;
  /** Таймаут запроса в мс (по умолчанию 60000 = 60s) */
  requestTimeoutMs?: number;
}

/** Значения по умолчанию для всех числовых настроек */
export const DEFAULT_RETRY_OPTIONS: Required<Omit<RetryOptions, 'onRetry' | 'signal'>> = {
  maxRetries: 3,
  baseDelayMs: 1000,
  maxDelayMs: 8000,
  retryOn: [429, 500, 502, 503, 504],
  requestTimeoutMs: 60000,
};

/**
 * Сетевые коды ошибок, которые считаются retryable.
 */
const RETRYABLE_NETWORK_CODES = new Set([
  'ECONNRESET',
  'ETIMEDOUT',
  'ENOTFOUND',
  'ECONNREFUSED',
  'EAI_AGAIN',
  'UND_ERR_CONNECT_TIMEOUT',
]);

/**
 * Фразы в тексте ошибки, указывающие на сетевую проблему.
 */
const NETWORK_PHRASES = ['fetch failed', 'network error', 'connection reset', 'connection error', 'connection refused', 'econnrefused'];

/**
 * Определяет, является ли ошибка retryable (можно повторить запрос).
 * Проверяет HTTP-статусы (error.status) и сетевые ошибки (error.code, error.message).
 *
 * НЕ ретраит на:
 * - 400 Bad Request — ошибка в запросе
 * - 401 Unauthorized — неверный API-ключ
 * - 403 Forbidden — доступ запрещён
 * - 404 Not Found — модель/эндпоинт не найден
 * - AbortError — пользователь отменил или таймаут (обрабатывается отдельно)
 *
 * @param error — объект ошибки (обычно от OpenAI SDK)
 * @param retryOn — список HTTP-статусов для ретрая
 */
/**
 * Определяет, является ли ошибка прерыванием запроса (отмена пользователем или таймаут).
 * OpenAI SDK бросает APIUserAbortError (name='Error', message='Request was aborted.'),
 * а не DOMException AbortError — поэтому проверяем оба варианта.
 */
export function isAbortError(error: any): boolean {
  if (!error) return false;
  if (error?.name === 'AbortError') return true;
  if (error?.name === 'APIUserAbortError') return true;
  if (typeof error?.message === 'string' && error.message.startsWith('Request was aborted')) return true;
  return false;
}

export function isRetryableError(error: any, retryOn: number[]): boolean {
  // AbortError — не ретраим здесь (обрабатывается в withRetry отдельно)
  if (isAbortError(error)) {
    return false;
  }

  // Проверка HTTP-статуса (OpenAI SDK кладёт статус в error.status)
  const status: number | undefined = error?.status;
  if (typeof status === 'number' && retryOn.includes(status)) {
    return true;
  }

  // Проверка кода сетевой ошибки (Node.js error.code)
  const code: string | undefined = error?.code;
  if (typeof code === 'string' && RETRYABLE_NETWORK_CODES.has(code)) {
    return true;
  }

  // Проверка текста ошибки на сетевые проблемы
  const message: string = error?.message || '';
  if (NETWORK_PHRASES.some((phrase) => message.toLowerCase().includes(phrase))) {
    return true;
  }

  return false;
}

/**
 * Вычисляет задержку с exponential backoff и jitter (±25%).
 *
 * Формула: delay = min(baseDelay * 2^(attempt-1), maxDelay)
 * Approach: attempt=1 → ~1s, attempt=2 → ~2s, attempt=3 → ~4s
 *
 * Добавляем случайный jitter: delay * (1 + random(-0.25, +0.25))
 * чтобы запросы от разных клиентов не попадали в одну секунду.
 *
 * @param attempt — номер попытки (1-based: 1 = первый ретрай)
 * @param baseDelayMs — базовая задержка в мс
 * @param maxDelayMs — максимальная задержка в мс
 * @returns задержка в мс (целое число)
 */
export function calculateDelay(
  attempt: number,
  baseDelayMs: number,
  maxDelayMs: number
): number {
  const exponentialDelay = Math.min(
    baseDelayMs * Math.pow(2, attempt - 1),
    maxDelayMs
  );
  // Jitter: случайный разброс ±25%
  const jitter = Math.random() * 0.5 - 0.25; // диапазон [-0.25, +0.25]
  return Math.round(exponentialDelay * (1 + jitter));
}

/**
 * Вспомогательная функция: ожидание на заданное количество миллисекунд.
 */
function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Выполняет асинхронную функцию с ретраями при ошибках.
 *
 * Алгоритм:
 * 1. Выполняет fn(signal). При успехе возвращает результат.
 * 2. При ошибке проверяет, retryable ли она (isRetryableError).
 * 3. Если retryable и есть оставшиеся попытки — ждёт с exponential backoff + jitter и повторяет.
 * 4. Если не-retryable или попытки исчерпаны — пробрасывает ошибку.
 * 5. AbortError обрабатывается особо: если пользователь отменил — сразу бросает,
 *    если таймаут — ретраит.
 *
 * @param fn — асинхронная функция для выполнения (принимает опциональный AbortSignal)
 * @param options — настройки ретрая
 * @returns результат выполнения fn
 * @throws последнюю ошибку после исчерпания всех попыток или не-retryable ошибку
 *
 * @example
 * const result = await withRetry(
 *   (signal) => client.chat.completions.create({...}, { signal }),
 *   { maxRetries: 3, requestTimeoutMs: 60000, onRetry: (a, m, d, e) => console.log(`Retry ${a}/${m}`) }
 * );
 */
export async function withRetry<T>(
  fn: (signal?: AbortSignal) => Promise<T>,
  options: RetryOptions = {}
): Promise<T> {
  const {
    maxRetries = DEFAULT_RETRY_OPTIONS.maxRetries,
    baseDelayMs = DEFAULT_RETRY_OPTIONS.baseDelayMs,
    maxDelayMs = DEFAULT_RETRY_OPTIONS.maxDelayMs,
    retryOn = DEFAULT_RETRY_OPTIONS.retryOn,
    onRetry,
    signal,
    requestTimeoutMs = DEFAULT_RETRY_OPTIONS.requestTimeoutMs,
  } = options;

  let lastError: any;
  const maxAttempts = maxRetries + 1; // основная попытка + N ретраев

  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      // Проверяем пользовательский сигнал до запроса
      if (signal?.aborted) {
        throw new DOMException('The operation was aborted', 'AbortError');
      }

      // Создаём составной сигнал: таймаут + пользовательский сигнал
      const timeoutSignal = AbortSignal.timeout(requestTimeoutMs);
      let effectiveSignal: AbortSignal;

      if (signal) {
        // Объединяем сигналы: любой из них прервёт запрос
        effectiveSignal = AbortSignal.any([signal, timeoutSignal]);
      } else {
        effectiveSignal = timeoutSignal;
      }

      return await fn(effectiveSignal);
    } catch (error: any) {
      lastError = error;

      // AbortError/APIUserAbortError: определяем источник
      if (isAbortError(error)) {
        if (signal?.aborted) {
          // Пользователь отменил запрос — не ретраим
          throw error;
        }
        // Это таймаут — ретраим, если есть попытки
        if (attempt < maxAttempts) {
          const delay = calculateDelay(attempt, baseDelayMs, maxDelayMs);
          const errorMsg = `таймаут ${requestTimeoutMs}ms`;
          console.log(
            `[RetryHandler] Повторная попытка ${attempt}/${maxRetries} через ${delay}ms (ошибка: ${errorMsg})`
          );
          if (onRetry) {
            try {
              onRetry(attempt, maxRetries, delay, errorMsg);
            } catch {
              /* игнорируем ошибки колбэка */
            }
          }
          await sleep(delay);
          continue;
        }
        throw error;
      }

      // Проверяем, нужно ли ретраить эту ошибку
      if (attempt >= maxAttempts || !isRetryableError(error, retryOn)) {
        throw error;
      }

      // Вычисляем задержку с backoff + jitter
      const delay = calculateDelay(attempt, baseDelayMs, maxDelayMs);

      // Формируем сообщение для лога
      const statusCode = error?.status ? ` ${error.status}` : '';
      const errorCode = error?.code ? ` ${error.code}` : '';
      const errorMsg = error?.message || 'неизвестная ошибка';
      const logMsg = `Повторная попытка ${attempt}/${maxRetries} через ${delay}ms (ошибка:${statusCode}${errorCode} ${errorMsg})`;

      // Логируем ретрай
      console.log(`[RetryHandler] ${logMsg}`);

      // Оповещаем колбэк (для WebView индикации)
      if (onRetry) {
        try {
          onRetry(attempt, maxRetries, delay, errorMsg);
        } catch {
          /* игнорируем ошибки колбэка */
        }
      }

      // Ждём перед следующей попыткой
      await sleep(delay);
    }
  }

  // Сюда не должны дойти, но на всякий случай:
  throw lastError;
}
