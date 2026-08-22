---
component: SessionLog
version: 0.1.0
status: planned
---

## Назначение

Единый append-only журнал событий сессии — **источник правды** для истории чата, реплея агента, экспорта и telemetry. Реализует инвариант dsh «model-visible ⟺ logged»: всё, что видит модель, восстанавливается из лога.

Консолидирует разрозненные источники в одно место:
- `SessionManager.messages` (финальные `{role, content}`, FIFO 100, мутирует) → проекция лога
- `RunHistoryStore` (агрегат steps/tokens/cost) → производные из лога
- `ContextSummarizer` (сжатие, заменяет историю) → `summary`-событие, история не теряется
- эмиттится-но-не-персистится: `AgentWorker.onStep`, `toolActivity`, стриминг-чанки

## Интерфейс

### Словарь `SessionEvent` (discriminated union по `type`)

| Тип | Поля | Эмиттер |
|-----|------|---------|
| `user/message` | `sessionId`, `content`, `pendingContext?` | ChatViewProvider |
| `assistant/chunk` | `sessionId`, `delta` | OpenAIProvider (стриминг) |
| `assistant/message` | `sessionId`, `content` | ChatViewProvider (по завершении) |
| `step/start` | `sessionId`, `stepId` | AgentWorker |
| `tool/call` | `sessionId`, `stepId`, `name`, `args` | AgentWorker |
| `tool/result` | `sessionId`, `stepId`, `name`, `result`, `error?` | AgentWorker |
| `step/end` | `sessionId`, `stepId` | AgentWorker |
| `confirm` | `sessionId`, `toolName`, `accepted` | ChatViewProvider |
| `summary` | `sessionId`, `content`, `replacedRange` | ContextSummarizer |
| `error` | `sessionId`, `message` | любой компонент |

### `SessionLog`

- `new SessionLog(storage: Memento)`
- `append(event)` — append-only, добавляет в конец, не мутирует
- `getEvents(sessionId, since?) → SessionEvent[]`
- `deriveMessages(sessionId, options?) → ChatMessage[]` — **чистая проекция** лога в модельный контекст (compaction-маркер + обрезка по `maxContextTokens`)
- `replay(sessionId) → SessionEvent[]` — полный путь агента (тулы + аргументы + результаты)
- `fork(sourceId) → newSessionId` — копия лога до точки
- `compact(sessionId, summary)` — вставляет `summary`-событие, старые события НЕ удаляет
- `computeStats(sessionId) → SessionStats` — производные метрики (steps/toolCalls/errors) для RunHistoryStore

## Контракты

| Ситуация | Поведение |
|----------|-----------|
| `append()` | добавляет в конец, никогда не перезаписывает |
| `deriveMessages()` > `maxContextTokens` | обрезает с конца, но лог не трогает |
| compaction | вставляет `summary`-маркер; история до маркера остаётся в логе |
| `fork()` | новый `sessionId`, копия событий до точки |
| миграция старой сессии | `messages[]` → `user/message` + `assistant/message` события |
| ошибка загрузки из storage | пустой лог + автосоздание сессии |
| `replay()` | детерминированный порядок событий, без артефактов рендера |

## AC

| ID | Критерий | Статус |
|----|----------|--------|
| SL-1 | Словарь `SessionEvent` определён (все 10 типов) | ✅ |
| SL-2 | `SessionLog.append()` персистит события (Memento) | ✅ |
| SL-3 | `deriveMessages()` — чистая проекция, воспроизводит модельный контекст | ✅ |
| SL-4 | `tool/call` + `tool/result` персистятся из `AgentWorker` | ✅ |
| SL-5 | `assistant/chunk` персистится из стриминга (throttle) | ✅ |
| SL-6 | `replay()` восстанавливает путь агента (тулы+аргументы+результаты) | ✅ |
| SL-7 | `fork()` создаёт сессию-копию | ✅ |
| SL-8 | `RunHistoryStore` считает cost/steps из лога | ✅ |
| SL-9 | миграция старых сессий без потери сообщений | planned |
| SL-10 | unit-тесты: append/derive/replay/fork/migrate | planned |

## Связи

- **Использует:** `vscode.Memento`
- **Используется:** SessionManager, ConversationManager, RunHistoryStore, ChatViewProvider, AgentWorker, WebView (реплей)
- **Поглощает/делает проекцией:** SessionManager.messages, ContextSummarizer, RunHistoryStore

## Детали реализации

- **Хранение (Этап 1–3):** `Memento` (workspaceState), ключ `llmAssistant.sessionLog`, `SessionEvent[]` на сессию. Сохраняет «лёгкий старт».
- **Хранение (Этап 4, по необходимости):** SQLite (`sql.js`) — общий с P8.
- **Миграция:** при загрузке старого формата `{meta, messages[]}` → конвертация в события, однократно.
- **`deriveMessages()`:** читает лог → отбрасывает до последнего `summary`-маркера → обрезает по токенам → отдаёт.
- **Персист чанков:** throttle (буфер N чанков или по завершении стрима), чтобы не писать Memento на каждый токен.
- **Связи при реализации:** `RunHistoryStore` → проекция; общий `sql.js` с P8; P6 до F1 = реворк части реплея; Share-to-Hermes → экспорт из лога; сплит `ChatViewProvider` вместе с рефактором.

## История изменений

| Версия | Дата | Изменения |
|--------|------|-----------|
| 0.1.0 | 2026-08-22 | Черновик spec (F1) — консолидация session-log |
| 0.1.0 | 2026-08-22 | Этап 1: SL-1/SL-2/SL-4/SL-5 — словарь + персист + wiring AgentWorker/стриминг |
| 0.1.0 | 2026-08-22 | Этап 2: SL-3 — deriveMessages() + compact() + user/message-эмиссия |
| 0.1.0 | 2026-08-22 | Этап 3: SL-6/SL-7/SL-8 — computeStats() + steps из лога в RunHistoryStore |
