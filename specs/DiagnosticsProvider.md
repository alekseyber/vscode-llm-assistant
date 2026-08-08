---
component: DiagnosticsProvider
version: 0.9.0
status: planned
since: 0.9.0
---

## Назначение

Сбор diagnostics (ошибок/предупреждений) с открытых редакторов и формирование контекстного блока для агента.

## Интерфейс

### `DiagnosticsProvider.getDiagnosticsContext() → string`

| Выход | Тип | Описание |
|-------|-----|----------|
| (return) | `string` | Форматированный блок «Диагностика: N ошибок, M предупреждений» или пустая строка |

### `DiagnosticsProvider.getDiagnosticsSummary() → { errors: number, warnings: number, files: string[] }`

| Выход | Тип | Описание |
|-------|-----|----------|
| `errors` | `number` | Количество ошибок |
| `warnings` | `number` | Количество предупреждений |
| `files` | `string[]` | Список затронутых файлов |

## Контракты

| Ситуация | Поведение |
|----------|-----------|
| Нет diagnostics | Возвращает пустую строку |
| Есть ошибки в открытых файлах | Формат: «⚠️ Диагностика: N ошибок, M предупреждений\nфайл:строка — сообщение» |
| Diagnostics только в неоткрытых файлах | Не включаются (только `window.visibleTextEditors`) |
| Максимум записей | 30 (обрезание, сообщение «...и ещё K» если больше) |

## Детали реализации

- **VS Code API:** `vscode.languages.getDiagnostics(uri)`, `vscode.DiagnosticSeverity.Error`, `vscode.DiagnosticSeverity.Warning`
- **Источник:** `vscode.window.visibleTextEditors` → `editor.document.uri`
- **Фильтр:** только Error и Warning (не Hint, не Information)
- **Формат:** `⚠️ Диагностика: 3 ошибки, 5 предупреждений\n\n**Ошибки:**\n- `src/file.ts:42` — Type 'string' is not assignable...\n- ...`
- **Лимит:** 30 записей, остаток: «...и ещё 12»
- **Вызов:** перед `runAgentLoop()` в `ChatViewProvider`

## Форматы данных

### Выходной формат (пример)

```
⚠️ Диагностика: 2 ошибки, 1 предупреждение

**Ошибки:**
- `src/modes/chat/ChatViewProvider.ts:284` — Property 'runAgentLoop' does not exist...
- `src/extension.ts:15` — Cannot find module './modes/codeactions/CodeActionsProvider'

**Предупреждения:**
- `src/shared/logger.ts:8` — Unused variable 'debugMode'

...и ещё 3
```

## Тесты

- AC-2.1: getDiagnosticsContext на чистом проекте → пустая строка
- AC-2.2: getDiagnosticsContext с ошибками → форматированный блок
- AC-2.3: getDiagnosticsSummary → правильные числа
- AC-2.4: больше 30 записей → обрезание с «...и ещё K»

## AC

| ID | Критерий | Статус |
|----|----------|--------|
| AC-2.1 | Пустой вывод при отсутствии diagnostics | planned |
| AC-2.2 | Форматированный блок с ошибками и предупреждениями | planned |
| AC-2.3 | Фильтрация только Error и Warning severity | planned |
| AC-2.4 | Лимит 30 записей + обрезание | planned |

## Связи

- **Использует:** `vscode.languages.getDiagnostics`, `vscode.window.visibleTextEditors`
- **Используется:** `ChatViewProvider` (перед agent loop)

## История изменений

| Версия | Дата | Изменения |
|--------|------|-----------|
| 0.9.0 | 2026-08-07 | Начальная спецификация |
