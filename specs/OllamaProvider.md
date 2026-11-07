---
component: OllamaProvider
version: 0.14.0
status: planned
since: 0.14.0
---

## Назначение

Провайдер локальных моделей через **нативный** API Ollama (`/api/chat`, `/api/tags`, `/api/show`). Существует потому, что OpenAI-совместимый `/v1` у Ollama не умеет отключать рассуждение: `think:false` в теле и `chat_template_kwargs.enable_thinking:false` игнорируются, thinking-модель (`qwen3:8b`) отдаёт пустой `content`, весь бюджет уходит в `reasoning`. Нативный `/api/chat` принимает `think` и отдаёт `thinking` отдельным полем — единственный рабочий путь (замерено 2026-10-18: 5,0 с против 27,3 с, `content` непустой).

## Интерфейс

Реализует `LLMProvider` (`src/providers/types.ts`) и наследует `BaseProvider`.

### `new OllamaProvider(config)`

| Параметр | Тип | Описание |
|----------|-----|----------|
| `name` | `string` | Имя провайдера из `llmAssistant.providers` |
| `baseUrl` | `string` | `http://127.0.0.1:11434` по умолчанию; trailing slash срезается |
| `models` | `string[]` | Модели из конфига; может быть пустым — тогда работает discovery |
| `apiKey` | `string` | Не используется (Ollama без аутентификации), принимается для совместимости с `BaseProvider` |
| `supportsVision` | `boolean?` | Признак для WebView; фактическая поддержка проверяется по `/api/show` |

`readonly isLocal: boolean = true` — используется вызывающими (`AgentWorker`, `ChatViewProvider`) вместо угадывания по имени модели.

### `chat(messages, options, signal?, onRetry?): AsyncIterable<string>`

Поток текста. `options.model` — тег модели (`gemma3:4b`), `options.temperature` → `options.temperature`, `options.maxTokens` → `options.num_predict`, `llmAssistant.local.numCtx` → `options.num_ctx`, `llmAssistant.local.think` → `think`. `options.extraBody` **игнорируется**: у нативного API нет произвольных полей тела (см. «Контракты»).

### `chatWithVision(messages, options, signal?, onRetry?): AsyncIterable<string>`

Сообщения с изображениями: `content` в формате `[{type:'text', text}, {type:'image_url', image_url:{url}}]` переводится в нативный вид Ollama — base64 в поле `images: [<base64 без префикса data:>]` того же сообщения. Остальное как в `chat()`.

### `createWithTools(messages, model, tools, signal?, onRetry?, extraBody?): Promise<any>`

Нестриминговый вызов с инструментами; возвращает объект **в форме OpenAI** (`choices[0].message.tool_calls[]` с синтезированным `id`, `usage`), чтобы `AgentWorker` не менялся. `extraBody` принимается для совместимости с интерфейсом и игнорируется.

### `chatComplete(messages, options, signal?, onRetry?): Promise<string>`

Нестриминговый текстовый ответ (summary, классификация) — тот же `/api/chat` с `stream:false`.

### `models(): Promise<string[]>`

Discovery: `GET /api/tags` → имена моделей. Кэш на 30 с. При ошибке соединения — список из конфига (`BaseProvider.models()`), без исключения.

### `capabilities(model): Promise<{tools: boolean; thinking: boolean; vision: boolean}>`

`POST /api/show` → `capabilities` (`completion`, `tools`, `thinking`, `vision`). Кэш на время сессии, вызывается только по явному действию (команда проверки сервера) — не на каждый рендер.

## Контракты

| Ситуация | Поведение |
|----------|-----------|
| `llmAssistant.local.think = false` (по умолчанию) | В тело уходит `"think": false`; поле `thinking` в ответе пустое, `content` непустой |
| `local.think = true` | `thinking` стримится отдельно и **не** попадает в `content`; в чат уходит ответ, а рассуждение — в session-log как отдельное событие |
| `content` пуст, а `thinking` непуст | Наружу отдаётся предупреждение «модель ушла в рассуждение: включите `think:false` или увеличьте лимит», а не пустая строка |
| `options.extraBody` передан | Игнорируется (нативный API не принимает произвольные поля); в debug-лог пишется строка о причине |
| Модель отсутствует на сервере (HTTP 404 `model not found`) | Ошибка с подсказкой `ollama pull <model>`; ретрай не выполняется (404 не retryable) |
| Соединение отклонено (`ECONNREFUSED`) | Ошибка с подсказкой: сервер не запущен / неверный `baseUrl` / нужен SSH-туннель; ретраи по общей политике `RetryHandler` |
| Сервер ответил 500/503 | Ретраи по `RetryHandler`; локальный таймаут — `local.requestTimeout` (300 с по умолчанию), не глобальные 60 с |
| Отмена (`AbortSignal`) | Поток прерывается сразу, соединение закрывается, следующий запрос не наследует состояние |
| `stream:false` (агент, summary) | Один JSON-объект вместо NDJSON; `eval_count` → `usage.completion_tokens`, `prompt_eval_count` → `usage.prompt_tokens` |
| Модель не умеет `tools` (нет capability) | При `local.toolLoop=false` агент не запускается; при `true` — ошибка с указанием, что модель не поддерживает инструменты |
| В конфиге `models: []` | `models()` возвращает результат discovery; при недоступном сервере — пустой список, селектор показывает то, что есть в settings у других провайдеров |

## Детали реализации

- **Транспорт:** `fetch` (Node 18+/VS Code runtime), NDJSON построчно: буфер, `split('\n')`, последняя неполная строка остаётся в буфере. OpenAI SDK не используется — он не умеет нативный формат.
- **Маппинг сообщений:** `ChatMessage` (`system`/`user`/`assistant`) → нативный вид без изменений ролей; входящая история агента (`assistant` с `tool_calls`, затем `role:'tool'` с `tool_call_id`) → `assistant` с `tool_calls[{function:{name,arguments}}]` и `role:'tool'` с `tool_name`; `id` при синтезе ответа — `call_<n>` (у нативного API идентификаторов нет).
- **Обратный маппинг:** нативный `message.tool_calls[]` → OpenAI-форма с `id`, `type:'function'`, `function.arguments` как **строка** JSON (`JSON.stringify`), потому что `AgentWorker` разбирает её через `JSON.parse`.
- **Кэш:** `models()` — 30 с на провайдера; `capabilities()` — до конца сессии. Кэш инвалидируется командой проверки сервера.
- **Таймауты:** `local.requestTimeout` (300 с) на запрос целиком; для `stream` — таймаут на первую строку потока, а не на весь ответ (иначе долгая генерация обрывается на 60-й секунде).
- **Логи:** запросы и ошибки — в существующий debug-канал; тело запроса целиком не логируется (может содержать код пользователя).

## Форматы данных

**Запрос `/api/chat`:**

```json
{
  "model": "qwen3:8b",
  "messages": [{"role": "user", "content": "..."}],
  "stream": true,
  "think": false,
  "options": {"temperature": 0.7, "num_predict": 4096, "num_ctx": 8192},
  "tools": [{"type": "function", "function": {"name": "...", "description": "...", "parameters": {}}}]
}
```

**Строка NDJSON (ответ):**

```json
{"model":"qwen3:8b","created_at":"...","message":{"role":"assistant","content":"Рефакторинг — это","thinking":""},"done":false}
```

**Финальная строка:**

```json
{"model":"qwen3:8b","message":{"role":"assistant","content":""},"done":true,"done_reason":"stop","prompt_eval_count":26,"eval_count":101}
```

**`GET /api/tags`:**

```json
{"models":[{"name":"qwen3:8b","model":"qwen3:8b","size":5228000000,"details":{"parameter_size":"8.2B","quantization_level":"Q4_K_M"}}]}
```

**`POST /api/show`:** `{"capabilities":["completion","tools","thinking"],"details":{...},"parameters":"..."}`

## AC

| ID | Критерий | Статус |
|----|----------|--------|
| OLL-1.1 | `chat()` стримит `content` из нативного NDJSON, непустой ответ при `think:false` | ⏳ planned |
| OLL-1.2 | `think` читается из `llmAssistant.local.think` (по умолчанию `false`) и уходит в тело | ⏳ planned |
| OLL-1.3 | `maxTokens` → `num_predict`, `local.numCtx` → `num_ctx` | ⏳ planned |
| OLL-1.4 | `extraBody` игнорируется, причина пишется в debug-лог | ⏳ planned |
| OLL-2.1 | `content` пуст при непустом `thinking` → предупреждение вместо пустого ответа | ⏳ planned |
| OLL-3.1 | `createWithTools()` отдаёт `tool_calls` в форме OpenAI, `arguments` — строка JSON | ⏳ planned |
| OLL-3.2 | История агента (`assistant.tool_calls` + `role:'tool'`) конвертируется в нативный вид; второй шаг цикла работает | ⏳ planned |
| OLL-4.1 | `models()` — `/api/tags` с кэшем 30 с; при недоступном сервере — конфиг, без исключения | ⏳ planned |
| OLL-4.2 | `capabilities()` — `/api/show`, только по явному вызову | ⏳ planned |
| OLL-5.1 | `chatWithVision()` переводит `image_url` (data-url) в нативное `images: [base64]` | ⏳ planned |
| OLL-6.1 | 404 «model not found» → ошибка с `ollama pull <model>`, без ретраев | ⏳ planned |
| OLL-6.2 | `ECONNREFUSED` → ошибка с подсказкой про сервер/туннель, ретраи по `RetryHandler` | ⏳ planned |
| OLL-6.3 | Отмена прерывает поток немедленно | ⏳ planned |
| OLL-7.1 | `isLocal === true` | ⏳ planned |
| OLL-8.1 | `usage` заполняется из `prompt_eval_count`/`eval_count`; стоимость = 0 через `pricingMap` | ⏳ planned |

## Тесты (ollamaProvider.test.ts, 12 тестов, planned)

Матрица «AC → тест» (пишется в Stage 6, мок-сервер на `node:http`, без живого Ollama):

- OLL-1.1: стрим из NDJSON-чанков отдаёт текст в правильном порядке
- OLL-1.2: `think:false` в теле запроса по умолчанию, `true` при настройке
- OLL-1.3: `num_predict` и `num_ctx` в `options`
- OLL-1.4: `extraBody` не попадает в тело
- OLL-2.1: `content` пуст + `thinking` непуст → предупреждение, а не пустая строка
- OLL-3.1: нативный `tool_calls` → OpenAI-форма, `arguments` — строка
- OLL-3.2: две итерации: `assistant.tool_calls` + `role:'tool'` в нативный вид, второй ответ доходит
- OLL-4.1: `/api/tags` парсится; второй вызов в пределах TTL не ходит в сеть; ошибка → список из конфига
- OLL-4.2: `/api/show` → capabilities, повторный вызов из кэша
- OLL-5.1: `image_url` data-url → `images: [base64]` без префикса
- OLL-6.1/6.2: 404 и `ECONNREFUSED` → разные сообщения, ретрай только на сетевой ошибке
- OLL-6.3: `AbortSignal` обрывает поток

## Связи

- **Использует:** `BaseProvider`, `LLMProvider` (`types.ts`), `RetryHandler`, `logger`
- **Используется:** `ProviderManager` (создаёт при `type: "ollama"`), `ChatViewProvider`, `AgentWorker` (через интерфейс), `ConversationManager`/`ContextSummarizer` (через `chat()`/`chatComplete()`)
- **Не использует:** OpenAI SDK (сознательно — другой протокол), `buildThinkingExtraBody` (рассуждение гасится нативно)

## История изменений

| Версия | Дата | Изменения |
|--------|------|-----------|
| 0.14.0 | 2026-10-18 | Создан (planned): нативный `/api/chat` + `/api/tags` + `/api/show`, `think:false`, `num_predict`/`num_ctx`, конвертация истории агента |
