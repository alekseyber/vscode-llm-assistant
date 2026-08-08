---
component: CodeActionsProvider
version: 0.9.0
status: planned
since: 0.9.0
---

## Назначение

Добавляет в меню лампочки (💡) Code Actions для выделенного кода: «Объясни», «Почини», «Спроси про это».

## Интерфейс

### `new CodeActionsProvider(chatViewProvider: ChatViewProvider)`

### `provideCodeActions(document, range, context, token) → CodeAction[]`

| Вход | Тип | Описание |
|------|-----|----------|
| `document` | `vscode.TextDocument` | Документ |
| `range` | `vscode.Range \| Selection` | Выделенный диапазон |
| `context` | `vscode.CodeActionContext` | Контекст (diagnostics прикреплены) |

| Выход | Тип | Описание |
|-------|-----|----------|
| (return) | `vscode.CodeAction[]` | Массив действий |

## Действия

| Действие | Заголовок | Промпт |
|----------|-----------|--------|
| `explain` | `💬 Объясни этот код` | `Объясни следующий код:\n\`\`\`\n{code}\n\`\`\`` |
| `fix` | `🔧 Почини ошибки` | `Почини ошибки в этом коде:\n\`\`\`\n{code}\n\`\`\`\n\nДиагностика:\n{diagnostics}` |
| `ask` | `❓ Спроси про это` | Открывает InputBox → пользователь вводит вопрос → `{вопрос}\n\n\`\`\`\n{code}\n\`\`\`` |

## Контракты

| Ситуация | Поведение |
|----------|-----------|
| Нет выделения (range.isEmpty) | Возвращает пустой массив |
| Есть выделение | 3 действия: explain, fix, ask |
| Diagnostics есть в context | fix включает diagnostics в промпт |
| Diagnostics нет | fix без блока диагностики |
| ask → InputBox пустой | Действие отменяется |
| Выбрано explain/fix | Промпт отправляется в чат → фокус на панель |

## Детали реализации

- **VS Code API:** `vscode.languages.registerCodeActionsProvider()`, `vscode.CodeAction`, `vscode.CodeActionKind.Empty`
- **Регистрация:** в `extension.ts` для всех языков: `{ language: '*' }` (или `{ scheme: 'file' }`)
- **Команда:** каждое действие — `vscode.CodeAction` с внутренней командой, которая дёргает `chatViewProvider.sendExternalPrompt(prompt)`
- **sendExternalPrompt:** новый публичный метод в `ChatViewProvider`:
  - Принимает текст промпта
  - Добавляет в WebView как сообщение пользователя
  - Запускает `handleSendMessage` в agent-режиме
  - Фокусирует чат-панель

### `ChatViewProvider.sendExternalPrompt(prompt: string)`

| Параметр | Тип | Описание |
|----------|-----|----------|
| `prompt` | `string` | Текст промпта |

Действия:
1. `postMessage({ type: 'externalPrompt', text: prompt })` — показать в WebView
2. `handleSendMessage(prompt, 'agent')` — запустить агента
3. `commands.executeCommand('llmAssistant.chat.focus')` — фокус

## Тесты

- AC-5.1: provideCodeActions без выделения → []
- AC-5.2: provideCodeActions с выделением → 3 действия
- AC-5.3: explain отправляет промпт в чат
- AC-5.4: fix включает diagnostics в промпт (если есть)
- AC-5.5: ask открывает InputBox и отправляет результат

## AC

| ID | Критерий | Статус |
|----|----------|--------|
| AC-5.1 | Действия появляются только при выделении | planned |
| AC-5.2 | «Объясни» отправляет код в чат | planned |
| AC-5.3 | «Почини» отправляет код + diagnostics | planned |
| AC-5.4 | «Спроси» открывает InputBox | planned |
| AC-5.5 | После действия — фокус на чат-панель | planned |

## Связи

- **Использует:** `vscode.languages.registerCodeActionsProvider`, `ChatViewProvider.sendExternalPrompt`
- **Используется:** `extension.ts` (регистрация)

## История изменений

| Версия | Дата | Изменения |
|--------|------|-----------|
| 0.9.0 | 2026-08-07 | Начальная спецификация |
