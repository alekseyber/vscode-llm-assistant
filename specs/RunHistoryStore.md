---
component: RunHistoryStore
version: 0.8.0
status: stable
since: 0.7.0
---

## Назначение

Хранилище истории запусков (чат, агент, edit). FIFO-буфер на 100 записей. Персистентное хранение через `ExtensionContext.globalState`.

## Интерфейс

### `new RunHistoryStore(globalState: Memento)`

### `recordRun(entry: RunEntry)`

Добавляет запись в начало. Если >100 — старые вытесняются.

### `getRuns(limit?) → RunEntry[]`

От новых к старым.

### `clearHistory()`

### `updateRun(runId, patch: Partial<RunEntry>)`

Обновляет существующую запись по id (смена статуса `running` → финальный). Не создаёт новую запись.

### `getRun(runId) → RunEntry | undefined`

### `generateRunId() → string`

Формат: `run_<timestamp>_<random6>`.

## RunEntry

| Поле | Тип |
|------|-----|
| id, timestamp | string, number |
| mode | 'chat' \| 'agent' \| 'edit' |
| task | string (100 символов) |
| provider, model | string |
| steps | number |
| tokensIn, tokensOut | number |
| cost | number (USD) |
| duration | number (ms) |
| status | 'running' \| 'success' \| 'error' \| 'cancelled' \| 'limit_exceeded' |
| error? | string |
| sessionId? | string (ID чат-сессии, для перехода по двойному клику) |

## Контракты

| Ситуация | Поведение |
|----------|-----------|
| Пустая история | `getRuns()` → [] |
| 101-я запись | Самая старая вытесняется |
| 150 записей | Сохраняется только 100 |
| Перезагрузка VS Code | Данные сохраняются (globalState) |
| `updateRun()` с несуществующим id | Запись не меняется (no-op) |

## Связи

- **Использует:** `vscode.Memento` (globalState)
- **Используется:** ChatViewProvider, registerCommands

## Детали реализации

- **Хранение:** `ExtensionContext.globalState`, ключ `llmAssistant.runHistory`
- **Структура:** `RunEntry[]`, новые в начало (unshift), FIFO 100
- **generateRunId:** `run_${Date.now()}_${Math.random().toString(36).slice(2,8)}`
- **cost:** `Math.round(cost * 1e6) / 1e6`


## Тесты (runHistoryStore.test.ts, 22 теста)

- getRuns() возвращает пустой массив при отсутствии истории
- recordRun() добавляет запись в начало
- getRuns(limit) возвращает не больше limit
- FIFO: максимум 100 записей, 101-я вытесняет старую; 150 → 100 сохранено
- clearHistory() удаляет все записи
- Корректно сохраняет все поля RunEntry (включая error, cancelled, limit_exceeded)
- generateRunId() генерирует уникальные ID, начинается с run_
- Данные сохраняются между экземплярами (persistent)
- Записи всех трёх режимов (chat, agent, edit) сохраняются
- recordRun() сохраняет sessionId (для перехода к сессии по двойному клику)
- recordRun() без sessionId — поле отсутствует
- updateRun() обновляет запись по id (running → success), не создаёт новую
- updateRun() игнорирует несуществующий id
- getRun() возвращает запись по id или undefined
- статус running сохраняется и сменяется на success
- жизненный цикл: recordRun(running) + updateRun(success) = одна запись (без «сирот»)
- recordRun/updateRun разных id — две разные записи (генерация и имплементация плана)

## История изменений

| Версия | Дата | Изменения |
|--------|------|-----------|
| 0.7.0 | 2026-08-05 | Базовая реализация |
| 0.10.0 | 2026-08-20 | Поле `sessionId` в RunEntry — связь записи с чат-сессией |
| 0.10.0 | 2026-08-20 | Статус `running`, методы `updateRun`/`getRun` (запись со старта + финализация) |
