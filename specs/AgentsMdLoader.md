---
component: AgentsMdLoader
version: 0.9.1
status: stable
since: 0.1.0
---

## Назначение

Загрузка правил главного агента из `.llma/main.md`. Кеширует содержимое, инвалидирует при изменении файла.

## Интерфейс

### `loadAgentsMd() → Promise<string | null>`

Читает `.llma/main.md` из корня workspace. Кеширует результат.

### `invalidateCache()`

Сбрасывает кеш вручную.

## Контракты

| Ситуация | Поведение |
|----------|-----------|
| Файл существует | Возвращает содержимое |
| Файла нет | null |
| `agentsMd.enabled: false` | null |
| Файл изменён | Авто-инвалидация кеша |
| Нет workspace | null |

## Связи

- **Используется:** ChatViewProvider (getSystemPrompt), ConversationManager (getMessagesForRequest), AgentController
- **Файл:** `.llma/main.md`

## Детали реализации

- **Кеш:** `cachedContent` + `lastFilePath`, инвалидация через watcher
- **Watcher:** `onDidChangeTextDocument`, `onDidCreateFiles`, `onDidDeleteFiles`
- **Файл:** `.llma/main.md` в корне workspace
- **Отключение:** `llmAssistant.agentsMd.enabled: false` → null


## Тесты (agentsMd.test.ts, 6 тестов)

- AC-1.1: loadAgentsMd() возвращает содержимое AGENTS.md
- AC-1.2: отсутствует — null
- AC-1.5: agentsMd.enabled: false отключает загрузку
- Кеширование: повторный вызов не читает файл
- AC-1.6: invalidateCache() сбрасывает кеш
- Нет workspace → null
- `AGENTS.md` + `CLAUDE.md` → склейка, `AGENTS.md` первым, источники подписаны (`AGM-2`)
- Лимит `agentsMd.maxChars` → обрезка с пометкой (`AGM-3`)
- Невалидный `maxChars` (false/0) → дефолт, правила на месте (`AGM-4`)

## История изменений

| Версия | Дата | Изменения |
|--------|------|-----------|
| 0.9.1 | 2026-11-10 | Правки по ревью deepseek-v4-pro: кеш сверяется по содержимому (mtime+size давали ложное попадание на быстрых правках), лимит считается по фактической длине чанка (был off-by-3), обрезка по границе строки и с учётом суррогатных пар, multi-root — корень активного редактора, watcher убран (stat/чтение и так на каждом вызове). AC `AGM-5/6` |
| 0.9.0 | 2026-11-10 | Стандартные файлы правил (P7): читаются `AGENTS.md` → `.llma/main.md` → `CLAUDE.md`, склейка с подписями источников, лимит `agentsMd.maxChars` (по умолчанию 12 000) с пометкой об обрезке, невалидное значение настройки игнорируется. Кеш сверяется по `mtime`+`size`. `getRulesSources()` — что попало в промпт. Раньше читался только `.llma/main.md`, хотя в промпт правило уходило с подписью «AGENTS.md». AC `AGM-2..4` |
| 0.8.0 | 2026-08-07 | Исправлены тесты: путь AGENTS.md → .llma/main.md |
| 0.1.0 | 2026-08-04 | Базовая реализация |
