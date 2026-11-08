---
component: OllamaProvider
version: 0.15.2
status: beta
since: 0.14.0
---

## Назначение

Провайдер локальных моделей через **нативный** API Ollama (`/api/chat`, `/api/tags`, `/api/show`). Существует потому, что OpenAI-совместимый `/v1` у Ollama не умеет отключать рассуждение: `think:false` в теле и `chat_template_kwargs.enable_thinking:false` игнорируются, thinking-модель (`qwen3:8b`) отдаёт пустой `content`, весь бюджет уходит в `reasoning`. Нативный `/api/chat` принимает `think` и отдаёт `thinking` отдельным полем — единственный рабочий путь (замерено 2026-11-07: 5,0 с против 27,3 с, `content` непустой).

## Интерфейс

Реализует `LLMProvider` (`src/providers/types.ts`) и наследует `BaseProvider`.

### `new OllamaProvider(config)`

| Параметр | Тип | Описание |
|----------|-----|----------|
| `name` | `string` | Имя провайдера из `llmAssistant.providers` |
| `baseUrl` | `string` | `http://127.0.0.1:11434` по умолчанию; trailing slash срезается |
| `models` | `string[]` | Модели из конфига; может быть пустым — тогда работает discovery |
| `apiKey` | `string` | Не используется (Ollama без аутентификации), принимается для совместимости с `BaseProvider` |
| `supportsVision` | `boolean?` | Не обязателен: если не задан, поддержка изображений определяется по capability `vision` из `/api/show` (см. `resolveVisionSupport` в ChatViewProvider) |

`readonly isLocal: boolean = true` — используется вызывающими (`AgentWorker`, `ChatViewProvider`) вместо угадывания по имени модели.

### `chat(messages, options, signal?, onRetry?): AsyncIterable<string>`

Поток текста. `options.model` — тег модели (`gemma3:4b`), `options.temperature` → `options.temperature`, `options.maxTokens` → `options.num_predict`, `llmAssistant.local.numCtx` → `options.num_ctx`, `llmAssistant.local.think` → `think`. **Эффективное окно = `min(numCtx, серверный OLLAMA_CONTEXT_LENGTH)`**: `num_ctx` уходит в запрос целиком, но модель видит меньше, если сервер ограничил окно, — и обрезка промпта при этом молчаливая. Отсюда предупреждение по `prompt_eval_count` (см. «Контракты»). `options.extraBody` **игнорируется**: у нативного API нет произвольных полей тела (см. «Контракты»).

### `chatWithVision(messages, options, signal?, onRetry?): AsyncIterable<string>`

Сообщения с изображениями: `content` в формате `[{type:'text', text}, {type:'image_url', image_url:{url}}]` переводится в нативный вид Ollama — base64 в поле `images: [<base64 без префикса data:>]` того же сообщения. Остальное как в `chat()`.

### `createWithTools(messages, model, tools, signal?, onRetry?, extraBody?): Promise<any>`

Нестриминговый вызов с инструментами; возвращает объект **в форме OpenAI** (`choices[0].message.tool_calls[]` с синтезированным `id`, `usage`), чтобы `AgentWorker` не менялся. `extraBody` принимается для совместимости с интерфейсом и игнорируется.

### `chatComplete(messages, options, signal?, onRetry?): Promise<string>`

Нестриминговый текстовый ответ (summary, классификация) — тот же `/api/chat` с `stream:false`.

### `models(): Promise<string[]>`

Discovery: `GET /api/tags` → имена моделей. Кэш на 30 с. При ошибке соединения — список из конфига (`BaseProvider.models()`), без исключения.

### `version(): Promise<string | undefined>`

`GET /api/version`. `undefined`, если сервер недоступен — команда проверки показывает подсказку вместо ошибки.

### `modelSizes(): Promise<Record<string, number>>`

`GET /api/tags` → размеры моделей в байтах (для отчёта команды проверки). Ошибка → `{}`.

### `invalidateCache(): void`

Сбрасывает кэш моделей и capabilities (вызывается командой проверки сервера).

### `describeLocalServer(provider): Promise<string[]>` (свободная функция)

Отчёт для команды «Проверить локальный сервер»: версия, число моделей, по строке на модель (`имя · размер · capabilities`). При недоступном сервере — две строки с подсказкой (`ollama serve`, baseUrl, SSH-туннель). Вынесена из команды, чтобы проверяться тестом без VS Code.

### `capabilities(model): Promise<{completion: boolean; embedding: boolean; tools: boolean; thinking: boolean; vision: boolean}>`

`POST /api/show` → `capabilities` (`completion`, `tools`, `thinking`, `vision`). Кэш на время сессии, вызывается только по явному действию (команда проверки сервера) — не на каждый рендер.

## Контракты

| Ситуация | Поведение |
|----------|-----------|
| `llmAssistant.local.think = false` (по умолчанию) | В тело уходит `"think": false`; поле `thinking` в ответе пустое, `content` непустой |
| `local.think = true` | `thinking` стримится отдельно и **не** попадает в `content`; в чат уходит ответ, а рассуждение — в session-log как отдельное событие |
| `content` пуст, а `thinking` непуст | Наружу отдаётся предупреждение «модель ушла в рассуждение: включите `think:false` или увеличьте лимит», а не пустая строка |
| `options.extraBody` передан | Игнорируется (нативный API не принимает произвольные поля); в debug-лог пишется строка о причине |
| Модель отсутствует на сервере (HTTP 404 `model not found`) | Ошибка с подсказкой `ollama pull <model>`; ретрай не выполняется (404 не retryable) |
| Соединение отклонено (`ECONNREFUSED`) | Ошибка с подсказкой: сервер мог быть остановлен намеренно — запустить его перед запросом; проверить `baseUrl`; для удалённой машины — SSH-туннель. Ретраи по общей политике `RetryHandler` |
| `prompt_eval_count >= numCtx - 16` (промпт упёрся в окно) | Одно предупреждение на модель за сессию: «Промпт, вероятно, обрезан: сервер обработал N токенов при лимите M. Проверьте `llmAssistant.local.numCtx` и `OLLAMA_CONTEXT_LENGTH` на сервере». Без падения и без ретрая |
| `prompt_eval_count` заметно меньше окна / отсутствует / `0` | Предупреждения нет; debug-строка с фактическим N пишется всё равно |
| Повторный ответ той же модели в той же сессии | Предупреждение не дублируется (ключ `provider:model`); другая модель предупреждает отдельно |
| `OLLAMA_NUM_PARALLEL > 1` на сервере | Окно делится между слотами (поведение сервера, плагин им не управляет); при `NUM_PARALLEL=1` деления нет. Диагностика — debug-строка N/M |
| Сервер ответил 500/503 | Ретраи по `RetryHandler`; локальный таймаут — `local.requestTimeout` (300 с по умолчанию), не глобальные 60 с |
| Отмена (`AbortSignal`) | Поток прерывается сразу, соединение закрывается, следующий запрос не наследует состояние |
| `stream:false` (агент, summary) | Один JSON-объект вместо NDJSON; `eval_count` → `usage.completion_tokens`, `prompt_eval_count` → `usage.prompt_tokens` |
| Модель не умеет `tools` (нет capability) | При `local.toolLoop=false` агент не запускается; при `true` — ошибка с указанием, что модель не поддерживает инструменты |
| В конфиге `models: []` | `models()` возвращает результат discovery; при недоступном сервере — пустой список, селектор показывает то, что есть в settings у других провайдеров |

## Детали реализации

- **Транспорт:** `fetch` (Node 18+/VS Code runtime), NDJSON построчно: буфер, `split('\n')`, последняя неполная строка остаётся в буфере. OpenAI SDK не используется — он не умеет нативный формат.
- **Маппинг сообщений:** `ChatMessage` (`system`/`user`/`assistant`) → нативный вид без изменений ролей; входящая история агента (`assistant` с `tool_calls`, затем `role:'tool'` с `tool_call_id`) → `assistant` с `tool_calls[{function:{name,arguments}}]` и `role:'tool'` с `tool_name`; `id` при синтезе ответа — `call_<n>` (у нативного API идентификаторов нет).
- **Обратный маппинг:** нативный `message.tool_calls[]` → OpenAI-форма с `id`, `type:'function'`, `function.arguments` как **строка** JSON (`JSON.stringify`), потому что `AgentWorker` разбирает её через `JSON.parse`.
- **Кэш:** `models()` — 30 с на провайдера (`MODELS_CACHE_TTL_MS`), `capabilities()` — до конца сессии. Кэш инвалидируется `invalidateCache()` (команда проверки сервера).
- **Слияние списков:** модели из конфига идут первыми (порядок пользователя), затем новые из `/api/tags`; дублей нет. При ошибке discovery возвращается ровно конфиг.
- **Фильтр эмбеддингов:** модель с явной capability `embedding` в чат-селектор не попадает (найдено ручным прогоном: `qwen3-embedding:0.6b` показывалась как чат-модель). Если `/api/show` недоступен или вернул пустой список capabilities — модель остаётся, чтобы не скрывать рабочие модели из-за сбоя сервера.
- **Цены после discovery:** `ChatViewProvider` при обновлении списка вызывает `providerManager.setZeroPricing(models)` для локального провайдера, поэтому найденные модели тоже бесплатны.
- **Таймауты:** `local.requestTimeout` (300 с); в потоке таймер продлевается на каждом чанке (`createTimeoutSignal().reset()`), поэтому долгая генерация не обрывается на 60-й секунде, а зависший поток закрывается по бездействию.
- **Ретраи:** берутся из общих настроек (`llmAssistant.retry.enabled` / `retry.maxRetries`), а не из хардкода; при выключенных ретраях — одна попытка. Ретраится только установление соединения, не сама генерация.
- **Код ошибки для `RetryHandler`:** `cause.code` из undici; если кода нет (например, «запрещённый» порт или иной текст), из сообщения извлекается `E[AAA-ZZZ]`-паттерн, иначе ставится `NETWORK_ERROR` — так сетевая ошибка остаётся retryable.
- **Логи:** запросы и ошибки — в существующий debug-канал; тело запроса целиком не логируется (может содержать код пользователя). Для агентского шага пишется строка `createWithTools: model=…, messages=N, tools=N` — по ней видно, ушли ли инструменты в запрос (понадобилось при разборе «модель ответила, не вызвав инструмент»).

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
| OLL-1.1 | `chat()` стримит `content` из нативного NDJSON, непустой ответ при `think:false` | ✅ |
| OLL-1.2 | `think` читается из `llmAssistant.local.think` (по умолчанию `false`) и уходит в тело | ✅ |
| OLL-1.3 | `maxTokens` → `num_predict`, `local.numCtx` → `num_ctx` | ✅ |
| OLL-1.4 | `extraBody` игнорируется, причина пишется в debug-лог | ✅ |
| OLL-2.1 | `content` пуст при непустом `thinking` → предупреждение вместо пустого ответа | ✅ |
| OLL-3.1 | `createWithTools()` отдаёт `tool_calls` в форме OpenAI, `arguments` — строка JSON | ✅ |
| OLL-3.2 | История агента (`assistant.tool_calls` + `role:'tool'`) конвертируется в нативный вид; второй шаг цикла работает | ✅ |
| OLL-4.1 | `models()` — `/api/tags` с кэшем 30 с; при недоступном сервере — конфиг, без исключения | ✅ |
| OLL-4.2 | `capabilities()` — `/api/show`, только по явному вызову | ✅ |
| OLL-5.1 | `chatWithVision()` переводит `image_url` (data-url) в нативное `images: [base64]` | ✅ |
| OLL-6.1 | 404 «model not found» → ошибка с `ollama pull <model>`, без ретраев | ✅ |
| OLL-6.2 | `ECONNREFUSED` → ошибка с подсказкой «сервер мог быть остановлен намеренно, запустите», про `baseUrl` и туннель; ретраи по `RetryHandler` | ✅ |
| OLL-6.3 | Отмена прерывает поток немедленно | ✅ |
| OLL-7.1 | `isLocal === true` | ✅ |
| OLL-8.1 | `usage` заполняется из `prompt_eval_count`/`eval_count`; стоимость = 0 через `pricingMap` | ✅ |
| OLL-9.1 | `prompt_eval_count >= num_ctx - 16` → предупреждение «промпт, вероятно, обрезан» с числами N и M | ✅ |
| OLL-9.2 | `prompt_eval_count` заметно меньше порога → предупреждения нет | ✅ |
| OLL-9.3 | Предупреждение один раз на модель за сессию; другая модель — предупреждает | ✅ |
| OLL-9.4 | Debug-строка `prompt_eval_count=N num_ctx=M model=X` пишется на каждый ответ (все четыре пути), включая `0`/отсутствие поля | ✅ |

## Тесты (`test/suite/ollamaProviderLocal.test.ts`, 8 тестов)

Сервер поднимается внутри теста (`node:http`), живой Ollama не нужен, в сеть тест не ходит.

| Тест | AC | Статус |
|------|----|--------|
| стримит `content` из NDJSON в правильном порядке | OLL-1.1 | ✅ |
| `think:false` по умолчанию, `think:true` при настройке | OLL-1.2 | ✅ |
| `maxTokens → num_predict`, `local.numCtx → num_ctx`, `max_tokens` не уходит | OLL-1.3 | ✅ |
| `extraBody` игнорируется и не попадает в тело | OLL-1.4 | ✅ |
| пустой `content` при непустом `thinking` → ошибка с подсказкой | OLL-2.1 | ✅ |
| 404 `model not found` → подсказка `ollama pull`, без ретраев | OLL-6.1 | ✅ |
| сервер недоступен → сообщение с подсказкой, `code` сохраняется для `RetryHandler` | OLL-6.2 | ✅ |
| отмена прерывает поток | OLL-6.3 | ✅ |
| `local.requestTimeout` ограничивает ожидание (провайдер, не глобальные 60 с) | OLL-6.4 / AW-1.3 | ✅ |
| инструменты: `tool_calls` → OpenAI-форма, конвертация истории | OLL-3.1, OLL-3.2 | ⏳ Stage 5 |
| `/api/tags` → список моделей, конфиг первым, кэш 30 с | OLL-4.1 | ✅ |
| эмбеддинг-модель отфильтрована; пустые capabilities / недоступный `/api/show` → модель остаётся | OLL-4.1 | ✅ |
| сервер недоступен → модели из конфига, `version()` → `undefined` | OLL-4.1 | ✅ |
| `/api/show` → capabilities, повторный вызов из кэша | OLL-4.2 | ✅ |
| `/api/show` упал → `undefined` без исключения | OLL-4.2 | ✅ |
| команда проверки: версия, модели, capabilities строкой на модель | OLL-4.2 | ✅ |
| команда проверки: сервер недоступен → подсказка, а не падение | OLL-4.2 | ✅ |
| vision: `image_url` → `images: [base64]` | OLL-5.1 | ⏳ Stage 3 |
| `usage` из `prompt_eval_count`/`eval_count` | OLL-8.1 | ⏳ Stage 5 |
| `prompt_eval_count == num_ctx` → предупреждение об обрезке | OLL-9.1 | ✅ |
| `prompt_eval_count` заметно меньше окна → тишина | OLL-9.2 | ✅ |
| предупреждение раз на модель; другая модель — предупреждает | OLL-9.3 | ✅ |
| debug-строка с N (в т.ч. `?` при отсутствии поля) на каждый ответ | OLL-9.4 | ✅ |
| граница порога `numCtx-16` / `numCtx-17`, `0`/`undefined`/`NaN` → `null` | CG-1, CG-2 | ✅ (`contextGuard.test.ts`) |
| текст предупреждения называет N, M, `local.numCtx`, `OLLAMA_CONTEXT_LENGTH` | CG-3 | ✅ (`contextGuard.test.ts`) |

## Связи

- **Использует:** `BaseProvider`, `LLMProvider` (`types.ts`), `RetryHandler`, `logger`
- **Используется:** `ProviderManager` (создаёт при `type: "ollama"`), `ChatViewProvider`, `AgentWorker` (через интерфейс), `ConversationManager`/`ContextSummarizer` (через `chat()`/`chatComplete()`)
- **Не использует:** OpenAI SDK (сознательно — другой протокол), `buildThinkingExtraBody` (рассуждение гасится нативно)

## История изменений

| Версия | Дата | Изменения |
|--------|------|-----------|
| 0.15.2 | 2026-11-09 | Пункт B: текст `ECONNREFUSED` — «сервер мог быть остановлен намеренно, запустите его перед запросом» (без пути к скрипту стенда); `OLL-6.2` дополнен проверками нового текста |
| 0.15.1 | 2026-11-09 | Пункт A: `buildTruncationWarning` (чистая функция) + `notePromptUsage` в четырёх путях ответа, разовое предупреждение на модель, debug-строка с N/M; тесты `OLL-9.1..9.4`, `CG-1..3`; 580 → 587 |
| 0.15.0 | 2026-11-09 | Контракты окна: эффективное окно = min(`local.numCtx`, серверный `OLLAMA_CONTEXT_LENGTH`), деление окна между слотами при `NUM_PARALLEL > 1`; AC `OLL-9.1..9.4` (диагностика молчаливой обрезки), `OLL-6.2` — новый текст про намеренно остановленный сервер |
| 0.14.8 | 2026-11-07 | `capabilities()` используется как источник правды о vision: ручной `supportsVision` не требуется |
| 0.14.7 | 2026-11-07 | Диагностический лог `createWithTools` (model / messages / tools) |
| 0.14.6 | 2026-11-07 | Фильтр эмбеддинг-моделей в discovery (по явной capability `embedding`), `completion`/`embedding` в `capabilities()`; +2 теста |
| 0.14.5 | 2026-11-07 | Stage 6: тест на локальный таймаут (OLL-6.4 / AW-1.3), матрица «AC → тест» в `TRACEABILITY.md`; базлайн 449 → 492 |
| 0.14.4 | 2026-11-07 | Vision: `chatWithVision` на нативном API, чистая `toNativeVisionMessages` (data-url → `images[]`); +2 теста |
| 0.14.3 | 2026-11-07 | Stage 5: `createWithTools` на нативном `/api/chat` (tools, конвертация истории в обе стороны, `usage`), чистые `toNativeMessages`/`toOpenAIToolCalls`; +4 теста |
| 0.14.2 | 2026-11-07 | Stage 3: discovery `/api/tags` с TTL-кэшем и слиянием с конфигом, `capabilities()`/`version()`/`modelSizes()`, `invalidateCache()`, `describeLocalServer()` для команды проверки; +6 тестов |
| 0.14.1 | 2026-11-07 | Stage 2: реализованы `chat()` и `chatComplete()` (нативный NDJSON), `think`/`num_predict`/`num_ctx`, маппинг ошибок 404/сети, `isLocal`; 8 тестов зелёные; status → beta |
| 0.14.0 | 2026-11-07 | Создан (planned): нативный `/api/chat` + `/api/tags` + `/api/show`, `think:false`, `num_predict`/`num_ctx`, конвертация истории агента |
