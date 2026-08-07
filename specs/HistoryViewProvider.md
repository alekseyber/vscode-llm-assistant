---
component: HistoryViewProvider
version: 0.8.0
status: stable
since: 0.7.0
---

## Назначение

WebView-вкладка «📊 История» в Activity Bar. Отображает таблицу запусков (чат, агент, edit) из RunHistoryStore.

## Интерфейс

### `new HistoryViewProvider(runHistoryStore: RunHistoryStore)`

### `resolveWebviewView(wv, ctx, token)`

### `refresh()` — обновить таблицу из хранилища

## Отображение

Таблица: дата | режим | задача | провайдер | модель | шаги | токены | стоимость | статус.

## Связи

- **Использует:** RunHistoryStore
- **Регистрация:** `package.json` → `llmAssistant.history`

## Детали реализации

- **Колонки:** дата, режим, задача, провайдер, модель, шаги, токены, стоимость, статус
- **refresh():** после каждого `recordRun()`
- **Стоимость:** `$${cost.toFixed(6)}`
- **Статусы:** success (зелёный), error (красный), cancelled (серый), limit_exceeded (жёлтый)


## История изменений

| Версия | Дата | Изменения |
|--------|------|-----------|
| 0.7.0 | 2026-08-05 | Базовая реализация |
