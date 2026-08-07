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
| status | 'success' \| 'error' \| 'cancelled' \| 'limit_exceeded' |
| error? | string |

## Контракты

| Ситуация | Поведение |
|----------|-----------|
| Пустая история | `getRuns()` → [] |
| 101-я запись | Самая старая вытесняется |
| 150 записей | Сохраняется только 100 |
| Перезагрузка VS Code | Данные сохраняются (globalState) |

## Связи

- **Использует:** `vscode.Memento` (globalState)
- **Используется:** ChatViewProvider, registerCommands

## История изменений

| Версия | Дата | Изменения |
|--------|------|-----------|
| 0.7.0 | 2026-08-05 | Базовая реализация |
