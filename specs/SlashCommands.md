---
component: SlashCommands
version: 0.9.0
status: stable
since: 0.9.0
---

## Назначение

Встроенные слэш-команды код-действий в чате (`/explain`, `/explain_stepbystep`, `/doc`, `/test`, `/review`, `/improve`). Каждая команда инжектирует директивный system-промпт в контекст, задающий модель поведение. Работает в режимах chat + agent, НЕ в Plan Mode.

Все команды включают общую директиву `READ_CODE_ONLY` — читать только файл с кодом (авто-контекст/workspace), НЕ скилы (`.llma/skills/`) и роли (`.llma/agents/`). Директива не содержит `⚠️`, поэтому не удаляется очисткой инжекта AgentWorker (MA-1.11).

## Интерфейс

### `interface SlashCommand`

| Поле | Тип | Описание |
|------|-----|----------|
| `name` | `string` | Имя команды без `/` |
| `description` | `string` | Краткое описание назначения |
| `defaultTask` | `string` | Задача по умолчанию (если аргумент пуст) |
| `promptTemplate` | `string` | Директивный system-промпт |

### `interface SlashParseResult`

| Поле | Тип | Описание |
|------|-----|----------|
| `name` | `string` | Имя команды без `/` |
| `argument` | `string` | Текст после имени (может быть пустым) |

### `const SLASH_COMMANDS: SlashCommand[]`

Массив из 6 встроенных команд.

### `const READ_CODE_ONLY: string` (внутренняя)

Общая директива, добавляемая в `promptTemplate` каждой команды. Запрещает агенту читать скилы/роли при код-действиях.

### `parseSlashCommand(text: string) → SlashParseResult | null`

Парсит префикс `/<имя> [аргумент]` в начале текста. Возвращает `null`, если текст не начинается со слэш-команды.

### `getSlashCommand(name: string) → SlashCommand | undefined`

Ищет встроенную команду по имени. Возвращает `undefined`, если команда не найдена.

## Контракты

| Ситуация | Поведение |
|----------|-----------|
| Текст `"/explain"` (без аргумента) | `parseSlashCommand` → `{name:'explain', argument:''}` |
| Текст `"/doc функция main"` | `parseSlashCommand` → `{name:'doc', argument:'функция main'}` |
| Текст `"/unknown"` | `parseSlashCommand` → `{name:'unknown', argument:''}`, `getSlashCommand('unknown')` → `undefined` |
| Текст без `/` в начале | `parseSlashCommand` → `null` |
| `getSlashCommand('explain')` | Возвращает команду с `promptTemplate`, содержащим «Слэш-команда /explain» |
| `getSlashCommand('nope')` | `undefined` |
| Имя команды содержит лишние пробелы `"/doc   foo"` | `argument` обрезается до `'foo'` |
| Режим Plan Mode | Слэш-команда НЕ обрабатывается (ветвление в PlanModeManager имеет приоритет) |

## AC

| ID | Критерий | Статус |
|----|----------|--------|
| SL-1 | Модуль `SlashCommands.ts` содержит 6 команд с полями `name`, `description`, `defaultTask`, `promptTemplate` | ✅ |
| SL-2 | `parseSlashCommand()` корректно разбирает префикс `/имя` и аргумент | ✅ |
| SL-3 | `getSlashCommand()` возвращает команду по имени, `undefined` для неизвестной | ✅ |
| SL-4 | Все 6 команд распознаются в `ChatViewProvider.handleSendMessage()` | ✅ |
| SL-5 | Команда инжектирует system-промпт на позицию 1 в `messages` (после системного промпта) | ✅ |
| SL-6 | Слэш-команды работают в chat + agent режимах, НЕ в Plan Mode | ✅ |
| SL-7 | `/skill` (загрузка скила из `.llma/skills/`) сохраняет обратную совместимость | ✅ |
| SL-8 | `@orchestrate` не затронут изменениями | ✅ |
| SL-9 | Все юнит-тесты зелёные, tsc тестов без ошибок, lint 0 ошибок | ✅ |

## Тесты (slashCommands.test.ts, 11 тестов)

- SL-2.1: `parseSlashCommand('/explain')` → `{name:'explain', argument:''}`
- SL-2.2: `parseSlashCommand('/doc функция main')` → `{name:'doc', argument:'функция main'}`
- SL-2.3: `parseSlashCommand('обычный текст')` → `null`
- SL-2.4: лишние пробелы в `/doc   foo` → `argument:'foo'`
- SL-1: `SLASH_COMMANDS.length === 6`, все имена на месте
- SL-3.1: `getSlashCommand('explain')` возвращает команду с корректным `promptTemplate`
- SL-3.2: `getSlashCommand('unknown')` → `undefined`
- SL-4: все 6 имён резолвятся через `getSlashCommand()`
- SL-5: `promptTemplate` содержит заголовок «Слэш-команда /<имя>»
- SL-5: `promptTemplate` НЕ содержит `⚠️` (не удаляется очисткой инжекта AgentWorker)
- READ_CODE_ONLY: `promptTemplate` каждой команды содержит «читай ТОЛЬКО файл с кодом» и `.llma/skills/`

## Связи

- **Используется:** `ChatViewProvider.handleSendMessage()` (парсинг и инжект)
- **Использует:** ничего (чистый модуль без зависимостей)

## История изменений

| Версия | Дата | Изменения |
|--------|------|-----------|
| 0.9.0 | 2026-08-18 | Первичная реализация: 6 слэш-команд (/explain, /explain_stepbystep, /doc, /test, /review, /improve), парсер, инжект в ChatViewProvider |
| 0.9.0 | 2026-08-19 | Директива READ_CODE_ONLY: код-действия читают только файл кода, не скилы/роли |
