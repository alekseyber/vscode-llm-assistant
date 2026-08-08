---
component: StatusBarIndicator
version: 0.9.0
status: planned
since: 0.9.0
---

## Назначение

Индикатор в статус-баре VS Code, показывающий текущее состояние агента: idle, streaming, thinking, error.

## Интерфейс

### `new StatusBarIndicator()`

Создаёт `StatusBarItem` с приоритетом 100 (ближе к левому краю).

### `setState(state: StatusBarState)` 

| Параметр | Тип | Описание |
|----------|-----|----------|
| `state` | `'idle' \| 'streaming' \| 'thinking' \| 'error'` | Новое состояние |

### `setTooltip(text: string)`

Обновляет tooltip (модель + токены последнего запроса).

### Константы состояний

| Состояние | Текст | Иконка | Цвет |
|-----------|-------|--------|------|
| `idle` | `LLM: idle` | `$(hubot)` | серый |
| `streaming` | `LLM: streaming` | `$(sync~spin)` | жёлтый |
| `thinking` | `LLM: thinking` | `$(loading~spin)` | синий |
| `error` | `LLM: error` | `$(error)` | красный |

## Контракты

| Ситуация | Поведение |
|----------|-----------|
| Старт расширения | `idle` |
| Начало стриминга / agent loop | `streaming` |
| Агент вызывает инструмент (tool_call) | `thinking` |
| Ошибка запроса | `error` |
| Завершение стриминга | `idle` |
| Клик по индикатору | Фокус на чат-панель (`llmAssistant.chat.focus`) |

## Детали реализации

- **VS Code API:** `vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Left, 100)`
- **Команда:** `command: 'llmAssistant.chat.focus'`
- **Инициализация:** в `extension.ts`, сохраняется в `ExtensionContext.subscriptions`
- **Доступ:** через глобальный синглтон или передаётся в `ChatViewProvider`
- **Анимация:** `$(sync~spin)` и `$(loading~spin)` — встроенные Codicon-анимации

## Тесты

- AC-3.1: создание StatusBarItem с правильным приоритетом
- AC-3.2: setState('streaming') → текст и иконка меняются
- AC-3.3: setState('error') → красная иконка
- AC-3.4: setState('idle') после streaming → возврат к idle

## AC

| ID | Критерий | Статус |
|----|----------|--------|
| AC-3.1 | Индикатор виден в статус-баре | planned |
| AC-3.2 | Состояния idle/streaming/thinking/error меняют текст и иконку | planned |
| AC-3.3 | Клик → фокус на чат-панель | planned |
| AC-3.4 | Tooltip обновляется с моделью и токенами | planned |

## Связи

- **Использует:** VS Code StatusBar API
- **Используется:** `ChatViewProvider`, `extension.ts`

## История изменений

| Версия | Дата | Изменения |
|--------|------|-----------|
| 0.9.0 | 2026-08-07 | Начальная спецификация |
