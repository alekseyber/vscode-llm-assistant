---
component: OpenAIProvider
version: 0.14.4
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

### `createWithTools(messages, model, tools, signal?, onRetry?, extraBody?) → Promise<any>`

Нестриминговый запрос с function calling. Возвращает полный ответ OpenAI SDK (choices + usage).

`extraBody` — **шестой необязательный** параметр: поля досыпаются в тело запроса рядом с `tools` (`...(extraBody ?? {})`). Добавлен в 0.14.0, потому что агентский цикл (`AgentWorker`) до этого не мог передать `thinking:{type:'disabled'}` и reasoning-модель deepseek съедала бюджет на рассуждение. Существующие вызовы без шестого аргумента работают как раньше.

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
| `createWithTools` с `extraBody` | Поля уходят в тело запроса вместе с `tools` и `tool_choice: 'auto'` |
| `createWithTools` без `extraBody` | Тело запроса как в 0.13.0 (обратная совместимость) |

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
- **extraBody:** `options.extraBody` спредится в тело запроса (для `thinking:{type:'disabled'}` у deepseek)
- **Vision:** content-массив `[{type:'text'},{type:'image_url'}]`


## Тесты (providers.test.ts)

- OAI-1.1: `createWithTools` прокидывает `extraBody` в тело; без аргумента тело не меняется (planned)
- AC-9.4: refresh() читает конфиг и создаёт провайдеров
- getProvider() / getDefault() / getAllProviders()
- refresh() очищает старых, обрабатывает пустую конфигурацию
- Подстановка ${VAR} из process.env

## История изменений

| Версия | Дата | Изменения |
|--------|------|-----------|
| 0.14.4 | 2026-11-09 | Discovery моделей для локального движка: `models()` при `isLocal` читает `GET /v1/models` (llama.cpp/LM Studio), сливает конфиг-первым, кэш 30 с, таймаут 3 с; при ошибке — конфиг. У облачных провайдеров discovery не включается сознательно (серверный список затёр бы выбранный набор). AC `OAI-3.1..3.4` |
| 0.14.3 | 2026-11-09 | `toProviderError()`: сетевые ошибки SDK завернуты в человеческий текст — для локального движка «сервер мог быть остановлен намеренно, запустите» + `baseUrl`, для облачного нейтрально; HTTP-ошибки (401/404/429) проходят как есть со `status` для `RetryHandler`; `code` сохраняется. AC `OAI-2.1/2.2` |
| 0.14.2 | 2026-11-09 | `isLocal` и `toolLoopOverride` из конфигурации провайдера: локальность решает `ProviderManager` по адресу, поэтому OpenAI-совместимый движок на loopback (llama.cpp) больше не считается облачным |
| 0.14.1 | 2026-11-07 | Stage 5: параметр реализован и прокинут, тело собирается один раз (`request`), 2 теста на тело с `extraBody` и без |
| 0.14.0 | 2026-11-07 | `extraBody` как необязательный 6-й параметр `createWithTools` (агентский цикл) |
| 0.13.0 | 2026-08-23 | extraBody в теле запроса (thinking disabled) |
| 0.1.0 | 2026-08-04 | Базовая реализация |
