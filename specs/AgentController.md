---
component: AgentController
version: 0.13.0
status: beta
since: 0.1.0
---

## Назначение

ReAct-агент для **Apply Mode** (отдельная команда, не чат). В отличие от AgentWorker, **не использует** function calling — получает от LLM текст, парсит JSON-вызов инструментов: `{"tool": "read_file", "arguments": {...}}`.

## Интерфейс

### `new AgentController(toolSystem: ToolSystem)`

### `controller.run(options) → AgentResult`

| Параметр | Описание |
|----------|----------|
| `provider` | LLM-провайдер |
| `model` | Имя модели |
| `task` | Задача пользователя |
| `maxIterations` | 20 (из настроек) |
| `signal` | AbortSignal для отмены |
| `onStep` | Колбэк для лога в Output Channel |

### `parseToolCall(responseText) → {name, arguments} | null`

Ищет JSON в тексте: `{"tool": "...", "arguments": {...}}`. Поддерживает markdown-блоки ```json.

## Контракты

| Ситуация | Поведение |
|----------|-----------|
| Ответ без JSON | Финальный ответ, завершение |
| JSON с tool + arguments | Выполнение через ToolSystem |
| arguments — строка JSON | Парсинг в объект |
| Инструмент не найден | Считается финальным ответом |
| Превышен лимит шагов | Завершение с сообщением |
| Отмена пользователем | AbortError → cancelled |
| Длинная история | Summary через ContextSummarizer |

## Отличия от AgentWorker

| AgentWorker | AgentController |
|-------------|-----------------|
| `createWithTools()` (function calling) | `provider.chat()` + JSON-парсинг |
| Через WebView (чат) | Через InputBox + Output Channel |
| Колбэки для UI | `onStep` для лога |
| Подтверждения через `onConfirm` | Без подтверждений |

## Связи

- **Использует:** ToolSystem, ContextSummarizer, ToolAllowList
- **Используется:** `registerCommands.startApplyMode()`

## Детали реализации

- **Парсинг JSON:** `parseToolCall()` ищет `{"tool": "...", "arguments": {...}}`. Сначала весь ответ как JSON, затем markdown-блок, затем от `{` до `}`. Проверяет что `tool` есть в ToolSystem.
- **Temperature:** 0 (детерминированный выбор инструментов)
- **maxTokens:** 4096 на запрос
- **История:** system + user → цикл: assistant (JSON) + tool result (как user)
- **Summary:** однократно при `i > 1 && messages.length > 2`. Сжимаются все кроме system, task, последней пары.
- **Отмена:** AbortController через `window.withProgress(cancellable:true)`

## Промпты

### Системный
```
Ты — AI-ассистент для программирования в VS Code.

Доступные инструменты:
{toolsDescription}

Формат ответа:
- Вызов: {"tool": "<имя>", "arguments": {...}}
- Ответ: обычный текст

Максимум шагов: {maxIterations}. Отвечай по-русски.
```

## Тесты

Прямых юнит-тестов нет. Покрывается интеграционно через Apply Mode.
Тестируется вручную: InputBox → задача → Output Channel → результат.

## История изменений

| Версия | Дата | Изменения |
|--------|------|-----------|
| 0.13.0 | 2026-08-23 | extraBody (thinking disabled для deepseek) |
| 0.1.0 | 2026-08-04 | Базовая реализация |
