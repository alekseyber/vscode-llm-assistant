---
component: AskUserTool
version: 0.8.21
status: stable
since: 0.8.4
---

## Назначение

Инструмент для агента, позволяющий задавать уточняющие вопросы пользователю через VS Code UI (QuickPick / InputBox). Блокирует ReAct-цикл до получения ответа.

## Интерфейс

### `AskUserTool`

Статический модуль, не класс. Экспортирует единственный инструмент `askUserTool: ChatTool`.

### `askUserTool.execute(args) → Promise<string>`

| Вход | Тип | Описание |
|------|-----|----------|
| `args.question` | `string` | Текст вопроса |
| `args.options` | `string[]?` | Варианты ответа (опционально) |

| Выход | Тип | Описание |
|-------|-----|----------|
| (resolve) | `string` | Выбранный вариант или введённый текст |
| (reject) | — | Никогда — вместо отказа возвращает "пользователь пропустил вопрос" |

## Контракты

| Ситуация | Поведение |
|----------|-----------|
| `options` передан (3+) | `showQuickPick` с вариантами |
| `options` передан (1-2) | `showInformationMessage` с `modal: true` |
| 2 варианта: да/нет | `showInformationMessage` с кнопками «Да» / «Нет» |
| `options` не передан или пуст | `showInputBox` с `ignoreFocusOut: true` |
| Вопрос содержит «нужно»/«надо»/etc без options | Авто-подстановка `['Да', 'Нет']` |
| Пользователь выбрал вариант | `[ВОПРОС ЗАКРЫТ] вопрос — ответ: вариант` |
| Пользователь ввёл текст (InputBox) | `[ВОПРОС ЗАКРЫТ] вопрос — ответ: текст` |
| Пользователь нажал Escape / закрыл | `(пропущено)` |
| `question` пустой или отсутствует | Ошибка: «вопрос обязателен» |

## Детали реализации

- **VS Code API:** `vscode.window.showQuickPick()`, `vscode.window.showInputBox()`, `vscode.window.showInformationMessage()`
- **Блокировка:** Promise, резолвится только после ответа пользователя
- **QuickPick:** `canPickMany: false`, `placeHolder: question`
- **InputBox:** `prompt: question`, `placeHolder: "Ваш ответ..."`
- **Интеграция:** добавляется в `CHAT_AGENT_TOOLS` массив, схема в `getToolSchemas()`
- **НЕ требует подтверждения** (не опасная операция)

## Промпты

### Системный промпт для агента (добавка)

```
Инструмент ask_user позволяет задать уточняющий вопрос пользователю.
Используй когда:
- Не хватает контекста для выполнения задачи
- Требуется выбор из нескольких вариантов
- Нужно подтверждение перед действием

Не злоупотребляй — задавай только действительно важные вопросы.
```

## Форматы данных

### Схема инструмента (OpenAI function calling)

```json
{
  "type": "function",
  "function": {
    "name": "ask_user",
    "description": "Задать уточняющий вопрос пользователю. Используй когда не хватает контекста или нужен выбор.",
    "parameters": {
      "type": "object",
      "properties": {
        "question": { "type": "string", "description": "Текст вопроса" },
        "options": {
          "type": "array",
          "items": { "type": "string" },
          "description": "Варианты ответа (опционально). Если 2 — да/нет кнопки."
        }
      },
      "required": ["question"]
    }
  }
}
```

## Тесты

- AC-1.1: ask_user с options → QuickPick, возвращает выбранный вариант
- AC-1.2: ask_user без options → InputBox, возвращает введённый текст
- AC-1.3: ask_user, пользователь закрыл → "(пропущено)"
- AC-1.4: ask_user с пустым question → ошибка
- AC-1.5: ask_user с 2 опциями → showInformationMessage с кнопками

## AC

| ID | Критерий | Статус |
|----|----------|--------|
| AC-1.1 | ask_user с options показывает QuickPick и возвращает выбор | ✅ |
| AC-1.2 | ask_user без options показывает InputBox и возвращает ввод | ✅ |
| AC-1.3 | Закрытие/Escape возвращает "(пропущено)" | ✅ |
| AC-1.4 | Пустой question → ошибка | ✅ |
| AC-1.5 | Инструмент доступен в списке tools агента | ✅ |

## Связи

- **Использует:** VS Code QuickPick/InputBox API
- **Используется:** `ChatAgentTools` (добавляется в массив `CHAT_AGENT_TOOLS`), `AgentWorker` (через getToolSchemas)

## История изменений

| Версия | Дата | Изменения |
|--------|------|-----------|
| 0.8.21 | 2026-08-08 | Статус stable, AC обновлены |
