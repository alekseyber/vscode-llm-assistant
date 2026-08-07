---
component: OpenAIProvider
version: 0.8.0
status: stable
since: 0.1.0
---

## Назначение

OpenAI-совместимый провайдер LLM. Обёртывает API-вызовы через OpenAI SDK с ретраями через RetryHandler.

## Интерфейс

### `new OpenAIProvider(config)`

| Параметр | Тип |
|----------|-----|
| `name` | string |
| `baseUrl` | string |
| `apiKey` | string |
| `models` | string[] |
| `supportsVision` | boolean |

### `chat(messages, options, signal?, onRetry?) → AsyncIterable<string>`

Стриминговый чат с опциональными ретраями.

### `chatWithVision(messages, options, signal?, onRetry?) → AsyncIterable<string>`

Vision-запрос с изображениями.

### `createWithTools(messages, model, tools, signal?, onRetry?) → Promise<any>`

Нестриминговый запрос с function calling. Возвращает полный ответ OpenAI SDK (choices + usage).

### `chatComplete(messages, options, signal?, onRetry?) → Promise<string>`

Нестриминговый запрос. Используется для summary.

### `models() → Promise<string[]>` — список из конфига

## Контракты

| Ситуация | Поведение |
|----------|-----------|
| Ретраи включены | withRetry оборачивает API-вызов |
| Ретраи выключены | Прямой вызов без retry |
| AbortSignal | Пробрасывается в OpenAI SDK |
| maxRetries: 0 в SDK | Отключено — используем свои ретраи |

## Связи

- **Использует:** OpenAI SDK, RetryHandler, BaseProvider
- **Используется:** ProviderManager
- **Конфигурация:** `llmAssistant.retry.*`

## Детали реализации

- **SDK:** `openai`, `maxRetries: 0` (свои ретраи)
- **baseUrl:** trailing slash удаляется
- **chat():** стриминг с withRetry
- **createWithTools():** нестриминг, `tool_choice: 'auto'`, с withRetry
- **chatComplete():** `stream: false`, temperature 0.3, maxTokens 2048
- **Vision:** content-массив `[{type:'text'},{type:'image_url'}]`


## История изменений

| Версия | Дата | Изменения |
|--------|------|-----------|
| 0.1.0 | 2026-08-04 | Базовая реализация |
