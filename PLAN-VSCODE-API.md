# PLAN: VS Code API Integration (v0.9.0)

> **SDD:** 30/30 specs ✅ → 5 этапов → AC-гейты → приёмка

**Цель:** Интегрировать 5 новых возможностей VS Code API: ask_user, diagnostics, status bar, decorations, code actions.

**Архитектура:** Новые модули в `src/shared/` и `src/modes/codeactions/`. Минимальные изменения в существующих `ChatAgentTools` и `ChatViewProvider`.

---

## Quality Gates (для каждого этапа)

1. ✅ Все AC этапа выполнены (самооценка по таблице)
2. ✅ `npm run compile` — без ошибок
3. ✅ `npx tsc -p tsconfig.test.json` — тесты компилируются
4. ✅ `npm run test:mocked` — все существующие тесты проходят
5. ✅ `npm run lint` — 0 ошибок
6. ✅ `git add -A && git commit -m "..." && git push origin main`
7. ❌ Если AC не выполнены → стоп, фикс, retest

**Замечание о правах:** Проект на bind-mount, поэтому перед каждым коммитом:
```bash
chmod -R 777 /opt/data/projects/vscode-llm-assistant/.git 2>/dev/null || true
```

---

## Этап 1: Ask User Tool

**Specs:** `specs/AskUserTool.md`
**Файлы:** Создать `src/modes/chat/AskUserTool.ts`, изменить `src/modes/chat/ChatAgentTools.ts`

### Шаги

1. **Создать `src/modes/chat/AskUserTool.ts`** — модуль с инструментом `ask_user`
   - Функция `createAskUserTool(): ChatTool`
   - `execute(args)`: если `options` есть → `showQuickPick`, иначе → `showInputBox`
   - Если options.length === 2 → `showInformationMessage` с кнопками
   - Escape/закрытие → `"(пропущено)"`
   - Пустой question → ошибка

2. **Добавить в `ChatAgentTools.ts`**
   - Импорт `createAskUserTool`
   - Добавить `askUserTool` в массив `CHAT_AGENT_TOOLS`

3. **Проверить allow-list**
   - `ask_user` не требует подтверждения → не добавлять в `requireConfirmation` по умолчанию
   - Убедиться что `getToolSchemas()` возвращает схему

4. **Тесты**
   - Создать `test/suite/askUserTool.test.ts`
   - Мокать `vscode.window.showQuickPick`, `showInputBox`, `showInformationMessage`

### AC: Этап 1

| ID | Критерий | Статус |
|----|----------|--------|
| AC-1.1 | ask_user с options показывает QuickPick и возвращает выбор | planned |
| AC-1.2 | ask_user без options показывает InputBox и возвращает ввод | planned |
| AC-1.3 | Закрытие/Escape возвращает "(пропущено)" | planned |
| AC-1.4 | Пустой question → ошибка | planned |
| AC-1.5 | ask_user доступен в getToolSchemas() | planned |

### Gate → Этап 2
Все AC-1.* = ✅ → переход к Этапу 2.

---

## Этап 2: Diagnostics Provider

**Specs:** `specs/DiagnosticsProvider.md`
**Файлы:** Создать `src/shared/DiagnosticsProvider.ts`, изменить `src/modes/chat/ChatViewProvider.ts`

### Шаги

1. **Создать `src/shared/DiagnosticsProvider.ts`**
   - `getDiagnosticsContext(): string` — собирает diagnostics с `window.visibleTextEditors`
   - Фильтр: только `DiagnosticSeverity.Error` и `Warning`
   - Лимит 30 записей
   - Формат: markdown-блок с группировкой по файлам

2. **Интегрировать в `ChatViewProvider.runAgentLoop()`**
   - Перед созданием AgentWorker: `const diagCtx = DiagnosticsProvider.getDiagnosticsContext()`
   - Если непусто — добавить в системный промпт (поле `systemPrompt`)

3. **Тесты**
   - `test/suite/diagnosticsProvider.test.ts`
   - Мокать `vscode.languages.getDiagnostics`, `window.visibleTextEditors`

### AC: Этап 2

| ID | Критерий | Статус |
|----|----------|--------|
| AC-2.1 | Пустой вывод при отсутствии diagnostics | planned |
| AC-2.2 | Форматированный блок с ошибками и предупреждениями | planned |
| AC-2.3 | Фильтрация только Error и Warning severity | planned |
| AC-2.4 | Лимит 30 записей + обрезание | planned |

### Gate → Этап 3
Все AC-2.* = ✅ → переход к Этапу 3.

---

## Этап 3: StatusBar Indicator

**Specs:** `specs/StatusBarIndicator.md`
**Файлы:** Создать `src/shared/StatusBarIndicator.ts`, изменить `src/extension.ts`, `src/modes/chat/ChatViewProvider.ts`

### Шаги

1. **Создать `src/shared/StatusBarIndicator.ts`**
   - Класс `StatusBarIndicator` с `StatusBarItem`
   - `setState(state)`: idle/streaming/thinking/error
   - `setTooltip(text)`: модель + токены
   - command: `llmAssistant.chat.focus`

2. **Инициализировать в `extension.ts`**
   - `const statusBar = new StatusBarIndicator()`
   - `context.subscriptions.push(statusBar)`
   - Передать в `ChatViewProvider` (через конструктор или метод)

3. **Обновлять состояние в `ChatViewProvider`**
   - `streaming` → при старте `handleSendMessage` и `runAgentLoop`
   - `thinking` → при `onStep({ type: 'tool_call' })`
   - `error` → при ошибках (catch блоки)
   - `idle` → при `finishStreaming` и `done`

4. **Тесты**
   - `test/suite/statusBarIndicator.test.ts`
   - Мокать `window.createStatusBarItem`

### AC: Этап 3

| ID | Критерий | Статус |
|----|----------|--------|
| AC-3.1 | Индикатор виден в статус-баре | planned |
| AC-3.2 | Состояния idle/streaming/thinking/error меняют текст и иконку | planned |
| AC-3.3 | Клик → фокус на чат-панель | planned |
| AC-3.4 | Tooltip обновляется с моделью и токенами | planned |

### Gate → Этап 4
Все AC-3.* = ✅ → переход к Этапу 4.

---

## Этап 4: Code Actions (лампочка 💡)

**Specs:** `specs/CodeActionsProvider.md`
**Зависит от:** ChatViewProvider.sendExternalPrompt (нужно добавить)
**Файлы:** Создать `src/modes/codeactions/CodeActionsProvider.ts`, изменить `src/extension.ts`, `src/modes/chat/ChatViewProvider.ts`

### Шаги

1. **Добавить `sendExternalPrompt()` в `ChatViewProvider`**
   - Публичный метод
   - `postMessage({ type: 'externalPrompt', text: prompt })`
   - `handleSendMessage(prompt, 'agent')`
   - `commands.executeCommand('llmAssistant.chat.focus')`

2. **Создать `src/modes/codeactions/CodeActionsProvider.ts`**
   - Класс `CodeActionsProvider` implements `vscode.CodeActionProvider`
   - `provideCodeActions()`: если `range.isEmpty` → `[]`
   - 3 действия: explain, fix, ask
   - explain/fix → `CodeAction` с командой → `sendExternalPrompt`
   - ask → `CodeAction` с командой → InputBox → `sendExternalPrompt`

3. **Зарегистрировать в `extension.ts`**
   - `languages.registerCodeActionsProvider({ scheme: 'file' }, provider)`

4. **Тесты**
   - `test/suite/codeActionsProvider.test.ts`
   - Мокать `commands.registerCommand`, `window.showInputBox`

### AC: Этап 4

| ID | Критерий | Статус |
|----|----------|--------|
| AC-5.1 | Действия появляются только при выделении | planned |
| AC-5.2 | «Объясни» отправляет код в чат | planned |
| AC-5.3 | «Почини» отправляет код + diagnostics | planned |
| AC-5.4 | «Спроси» открывает InputBox | planned |
| AC-5.5 | После действия — фокус на чат-панель | planned |

### Gate → Этап 5
Все AC-5.* = ✅ → переход к Этапу 5.

---

## Этап 5: Decorations Manager

**Specs:** `specs/DecorationsManager.md`
**Файлы:** Создать `src/shared/DecorationsManager.ts`, изменить `src/modes/chat/ChatAgentTools.ts`

### Шаги

1. **Создать `src/shared/DecorationsManager.ts`**
   - Класс-синглтон `DecorationsManager`
   - `highlightAdded(uri, range)` — зелёная подсветка
   - `highlightModified(uri, range)` — жёлтая подсветка
   - `clearForFile(uri)`, `clearAll()`
   - Автосброс через 5 секунд (`setTimeout`)
   - Сброс при `onDidChangeTextDocument`

2. **Интегрировать в `ChatAgentTools`**
   - Импорт `DecorationsManager`
   - В `writeFileTool.execute`: после записи → `highlightAdded(uri, fullRange)`
   - В `replaceInFileTool.execute`: после замены → `highlightModified(uri, changeRange)`
   - Передавать синглтон через параметр или глобально

3. **Тесты**
   - `test/suite/decorationsManager.test.ts`
   - Мокать `window.createTextEditorDecorationType`, `editor.setDecorations`

### AC: Этап 5

| ID | Критерий | Статус |
|----|----------|--------|
| AC-4.1 | После write_file строки подсвечиваются зелёным | planned |
| AC-4.2 | После replace_in_file строки подсвечиваются жёлтым | planned |
| AC-4.3 | Подсветка сбрасывается через 5 секунд | planned |
| AC-4.4 | Подсветка сбрасывается при ручном редактировании | planned |

---

## Приёмка (после всех этапов)

1. `npm run compile && npm run lint && npm test` — всё чисто
2. CI зелёный (Test + SDD Check)
3. Обновить CHANGELOG.md
4. Бамп версии `package.json` → `0.9.0-rc1`
5. VSIX: `npx @vscode/vsce package --no-yarn`

---

## Карта зависимостей

```
Этап 1 (AskUserTool) ──────┐
                            ├──→ Этап 3 (StatusBar) ──┐
Этап 2 (Diagnostics) ──────┘                         ├──→ Этап 5 (Decorations)
                                                     │
                            Этап 4 (CodeActions) ────┘
                            (зависит от sendExternalPrompt)
```

Этапы 1 и 2 — независимы (можно параллельно).
Этапы 3, 4 — после 1+2.
Этап 5 — последний (наименьший приоритет).
