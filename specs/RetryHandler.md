---
component: RetryHandler
version: 0.8.0
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

## Контракты

| Ситуация | Поведение |
|----------|-----------|
| 429, 500, 502, 503, 504 | Ретрай с backoff |
| 400, 401, 403, 404 | Сразу ошибка |
| ECONNRESET, ETIMEDOUT, ENOTFOUND | Ретрай |
| AbortError (пользователь) | Сразу ошибка, без ретрая |
| AbortError (таймаут) | Ретрай |
| Ретрай 1 → 3 | Задержка: ~1s → ~2s → ~4s (±25% jitter) |
| maxRetries=0 | Без ретраев |

## Связи

- **Используется:** OpenAIProvider (chat, createWithTools, chatComplete)
- **Конфигурация:** `llmAssistant.retry.*` в settings.json

## История изменений

| Версия | Дата | Изменения |
|--------|------|-----------|
| 0.3.0 | 2026-08-05 | Базовая реализация |
