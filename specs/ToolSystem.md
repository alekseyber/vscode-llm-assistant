---
component: ToolSystem
version: 0.8.0
status: stable
since: 0.1.0
---

## Назначение

Реестр инструментов для Apply Mode (AgentController). Отличается от ChatAgentTools — используется **только** AgentController, не чат-агентом.

## Интерфейс

### `new ToolSystem()`

### `register(tool: Tool)` / `registerAll(tools: Tool[])`

### `getTool(name) → Tool | undefined`

### `getTools() → Tool[]`

### `execute(name, args) → string`

Выполняет инструмент с валидацией аргументов по JSON Schema.

### `validateArgs(tool, args) → string | null`

Проверяет обязательные поля и типы.

### `formatResult(name, output, ok) → string`

Форматирует: `=== Результат: name [OK/ОШИБКА] ===\noutput`. Обрезает до 20000 символов.

### `getToolsDescription() → string` / `getToolSchemas() → ToolSchema[]`

## Контракты

| Ситуация | Поведение |
|----------|-----------|
| Дублирование имени | Ошибка при register |
| Инструмент не найден | `execute` → формат «ОШИБКА: не найден» |
| Невалидные аргументы | Ошибка валидации (обязательное поле / тип) |
| Ошибка в execute | Формат «ОШИБКА: message» |
| Вывод > 20000 символов | Обрезается с пометкой |

## Связи

- **Используется:** AgentController
- **Данные:** ToolDefinitions.createTools()

## Детали реализации

- **Хранение:** `Map<string, Tool>`
- **validateArgs:** проверка обязательных полей и типов (string/number/boolean/object/array)
- **formatResult:** `=== Результат: {name} [{OK|ОШИБКА}] ===
{output}`, обрезка 20000
- **Дублирование:** ошибка при register с существующим именем


## Тесты (tools.test.ts, 15+ тестов)

- AC-9.5: register() добавляет инструмент, ошибка при дублировании
- getTool() возвращает undefined для неизвестного
- execute() с валидными аргументами, с ошибкой валидации, с ошибкой инструмента
- validateArgs(): проверка обязательных полей, типов (string/number/boolean/object/array)
- formatResult(): OK/ОШИБКА, обрезка длинного вывода
- getToolsDescription() / getToolSchemas() возвращают описания

## История изменений

| Версия | Дата | Изменения |
|--------|------|-----------|
| 0.1.0 | 2026-08-04 | Базовая реализация |
