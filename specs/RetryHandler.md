---
component: RetryHandler
version: 0.12.0
status: stable
since: 0.3.0
---

## Назначение

Обёртка с exponential backoff + jitter для API-вызовов к LLM. Обрабатывает 429, 5xx, сетевые ошибки. Не ретраит 400, 401, 403, 404.

## Интерфейс

### `withRetry<T>(fn, options?) → Promise<T>`

| Параметр | По умолчанию | Описание |
|----------|-------------|----------|
| `maxRetries` | 3 | Макс. повторных попыток |
| `baseDelayMs` | 1000 | Базовая задержка |
| `maxDelayMs` | 8000 | Макс. задержка |
| `retryOn` | [429, 500, 502, 503, 504] | Ретраить на этих статусах |
| `requestTimeoutMs` | 60000 | Таймаут запроса |
| `onRetry` | — | Колбэк для WebView-индикации |
| `signal` | — | AbortSignal от пользователя |

### `isRetryableError(error, retryOn) → boolean`

### `calculateDelay(attempt, baseDelayMs, maxDelayMs) → number`

Формула: `min(baseDelay * 2^(attempt-1), maxDelay) * (1 + random(-0.25, 0.25))`

### `isAbortError(error) → boolean`

Распознаёт отмену: `AbortError` (`name === 'AbortError'`) **и** `APIUserAbortError` (OpenAI SDK — `name === 'Error'`, message `'Request was aborted.'`).

## Контракты

| Ситуация | Поведение |
|----------|-----------|
| 429, 500, 502, 503, 504 | Ретрай с backoff |
| 400, 401, 403, 404 | Сразу ошибка |
| ECONNRESET, ETIMEDOUT, ENOTFOUND | Ретрай |
| AbortError / APIUserAbortError (пользователь) | Сразу ошибка, без ретрая |
| AbortError (таймаут) | Ретрай |
| Ретрай 1 → 3 | Задержка: ~1s → ~2s → ~4s (±25% jitter) |
| maxRetries=0 | Без ретраев |

## Связи

- **Используется:** OpenAIProvider (chat, createWithTools, chatComplete)
- **Конфигурация:** `llmAssistant.retry.*` в settings.json

## Детали реализации

- **Формула задержки:** `min(baseDelay * 2^(attempt-1), maxDelay) * (1 + random(-0.25, +0.25))`
- **Составной сигнал:** `AbortSignal.any([userSignal, timeoutSignal])` — любой прерывает запрос
- **Таймаут:** `AbortSignal.timeout(requestTimeoutMs)`
- **AbortError:** если `userSignal.aborted` → не ретрай (пользователь). Если нет → ретрай (таймаут)
- **isAbortError:** распознаёт `AbortError` (по `name`) и `APIUserAbortError` (OpenAI SDK: `name='Error'`, message `'Request was aborted.'`) — используется везде вместо сравнения `name === 'AbortError'`
- **Сетевые коды:** ECONNRESET, ETIMEDOUT, ENOTFOUND, ECONNREFUSED, EAI_AGAIN, UND_ERR_CONNECT_TIMEOUT
- **Сетевые фразы в message:** fetch failed, network error, connection reset, connection error, connection refused, econnrefused
- **HTTP-статусы для ретрая:** [429, 500, 502, 503, 504] (настраивается)
- **maxRetries=0:** без ретраев, сразу ошибка
- **Колбэк onRetry:** безопасный вызов в try/catch

## Тесты (retryHandler.test.ts, 25+ тестов)

- isRetryableError: 429/500/502/503/504 → retryable; 400/401/403/404 → НЕ retryable
- AbortError → НЕ retryable; таймаут → retryable
- isAbortError: распознаёт AbortError и APIUserAbortError (name='Error', message='Request was aborted.') как отмену
- Сетевые коды: ECONNRESET, ETIMEDOUT, ENOTFOUND, ECONNREFUSED → retryable
- Сетевые фразы в message: "fetch failed", "network error" → retryable
- calculateDelay: jitter ±25%, attempt=2 ~2s, attempt=3 ~4s, не превышает maxDelay
- withRetry: успех с первой попытки, ретрай с backoff, max 3 ретрая
- maxRetries=0 → без ретраев, сразу ошибка
- onRetry колбэк вызывается при каждом ретрае
- AbortSignal прерывает ретраи; прерванный сигнал до вызова → сразу AbortError

## История изменений

| Версия | Дата | Изменения |
|--------|------|-----------|
| 0.12.0 | 2026-08-22 | Хелпер `isAbortError()` — распознаёт APIUserAbortError (OpenAI SDK, name='Error') как отмену |
| 0.3.0 | 2026-08-05 | Базовая реализация |
