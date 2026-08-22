---
component: ChatViewProvider
version: 0.8.0
status: stable
since: 0.1.0
---

## Назначение

Главный WebView-хаб расширения. Обрабатывает все сообщения из чата: чат, агент, vision, @orchestrate. Делегирует AgentWorker для ReAct-цикла.

## Интерфейс

### `new ChatViewProvider(ctx, providerManager, conversationManager, runHistoryStore, historyViewProvider?, orchestratorViewProvider?, sessionLog?)`

### `resolveWebviewView(wv, ctx, token)` — точка входа WebView

### Обработчики сообщений

| Тип | Метод |
|-----|-------|
| `sendMessage` | `handleSendMessage(text, mode, provider?, model?)` |
| `cancelRequest` | `handleCancelRequest()` |
| `clearHistory` | `conversationManager.clearHistory()` |
| `newSession` / `switchSession` / `deleteSession` / `renameSession` | Делегирование в `SessionManager` |

### `handleSendMessage(text, mode, provider?, model?)`

- Определяет провайдера и модель
- `@orchestrate` → `handleOrchestrate()`
- `/skill` → инжект скила из `.llma/skills/`
- слэш-команды (`/explain`, `/doc`, `/test`, `/review`, `/improve`, `/explain_stepbystep`) → инжект директивного system-промпта (см. `specs/SlashCommands.md`)
- `mode='agent'` → проверка `createWithTools` → `runAgentLoop()`
- `mode='chat'` → `provider.chat(stream)`
- Vision → `provider.chatWithVision()`

### `runAgentLoop(provider, model, messages)` → делегирует `AgentWorker.run()`

### `handleOrchestrate(taskText, provider, model)` → `AgentOrchestrator.execute()`

| `recordChatRun()` — запись в `RunHistoryStore` с `calculateCost()`

### `sendExternalPrompt(prompt: string)` ← **0.9.0**

Принимает внешний промпт (из Code Actions), отправляет в чат как агент.

| Вход | Тип | Описание |
|------|-----|----------|
| `prompt` | `string` | Текст промпта |

Действия: `postMessage({ type: 'externalPrompt', text })` → `handleSendMessage(prompt, 'agent')` → `commands.executeCommand('llmAssistant.chat.focus')`.

## Контракты

| Ситуация | Поведение |
|----------|-----------|
| Провайдер не поддерживает `createWithTools` | Ошибка «не поддерживает режим Агента» |
| `@orchestrate` вне агентного режима | Игнорируется |
| Vision + нет `supportsVision` | Ошибка |
| MCP-сервер недоступен | Лог в debugChannel, агент работает без MCP |
| Plan Mode ON + agent-режим | Ветвление в PlanModeManager.generatePlan() вместо runAgentLoop() |
| Plan Mode ON + chat-режим | Игнорируется — обычный чат |
| Контекст кода | `attachCodeContext` ДО `addMessage` |
| Внешний промпт (Code Actions) | `sendExternalPrompt` → agent-режим → фокус |
| Diagnostics перед agent loop | `DiagnosticsProvider.getDiagnosticsContext()` → в системный промпт |
| SkillsLoader: скилы в system prompt | `loadSkillsSummary()` → после AGENTS.md в getSystemPrompt() |
| Слэш-команда (`/explain`, `/doc`, ...) | Инжект `promptTemplate` на позицию 1, `text` = аргумент или `defaultTask` |

## Связи

- **Использует:** ProviderManager, ConversationManager, AgentWorker, AgentOrchestrator, McpClient, RunHistoryStore, DiagnosticsProvider, StatusBarIndicator, AgentsMdLoader, SkillsLoader, SlashCommands
- **Используется:** extension.ts (регистрация WebView)

## Детали реализации

- **WebView:** `enableScripts: true`, localResourceRoots — src/webviews/chat и node_modules
- **HTML:** index.html + styles.css + marked.min.js + main.js через `fs.readFileSync`
- **Auto-контекст:** активный редактор → `attachCodeContext()` ДО `addMessage()`
- **Vision:** `pendingImage`, одно сообщение `[{type:'text'},{type:'image_url'}]`
- **@orchestrate:** regex `/^@orchestrate\s+(.+)/`, только agent-режим
- **recordChatRun:** стоимость через `calculateCost()` с `providerManager.pricingMap`
- **abortController:** создаётся в handleSendMessage, проверяется в runAgentLoop
- **debugChannel:** `vscode.window.createOutputChannel('LLM Assistant')`
- **Инжект ask_user:** перед agent-режимом, если текст содержит триггер-слова (`спроси`, `уточни`, ...), в `messages` на позицию 1 вставляется system-сообщение с `⚠️`, принуждающее модель вызвать инструмент. AgentWorker удаляет этот инжект после выполнения `ask_user` (см. AgentWorker#Очистка инжекта). При следующем `handleSendMessage` инжект создаётся заново.
- **Слэш-команды:** `parseSlashCommand()` разбирает префикс `/<имя> [аргумент]`. Сначала `loadSkillMd()` (обратная совместимость `/skill`), затем `getSlashCommand()`. Промпт слэш-команды НЕ содержит `⚠️` — иначе AgentWorker удалит его при очистке инжекта (MA-1.11). Инжект на позицию 1, `text` = аргумент или `defaultTask`.
- **Принудительная запись (`writes: true`):** для `/doc` и `/test` в agent-режиме из промпта убирается инструкция «в chat-режиме выведи текст» (сбивает DeepSeek) и добавляется `⚠️`-директива «вызови write_file/replace_in_file СЕЙЧАС» — иначе модель отвечает текстом вместо function calling. Директива удаляется очисткой AgentWorker после первого вызова тула (штатно).
- **Диалог подтверждения (git-diff):** `requestConfirmation` для `write_file` читает текущее содержимое файла (`oldContent`) и передаёт в WebView; `showConfirmDialog` строит LCS-диф строк (context/remove/add) и выводит git-style: зелёные `+`, красные `−`, счётчик `+N −M`, контекстные строки без подсветки.
- **Ход выполнения (`toolActivity`):** вызовы тулов и их результаты (`onStep`, `onConfirm`) отправляются в WebView как структурированные `toolActivity`-сообщения (`{kind: 'start'|'result'|'note'}`). WebView рендерит каждый тул отдельным сворачиваемым шагом (`<details>`: заголовок «🔧 toolName» + статус `…`/`✓`, тело — результат), короткие результаты раскрываются сразу, длинные — свёрнуты. Заметка (запрос подтверждения) — подсвеченная строка. По завершении (`done`) активность скрывается, в финальный ответ (`streamingRawText`) попадает только `result.answer`. При переключении/восстановлении сессии (`restoreHistory`) WebView сбрасывает стрим-состояние (`resetStreamingState`) — иначе остаётся «зависший» блок с курсором.
- **Сессионная маршрутизация + параллельные процессы:** `sendMessage`/`cancelRequest`/`implementPlan` передают `sessionId`. `postMessage(m, sessionId)` тегирует сообщение; WebView игнорирует сообщения с `sessionId !== currentSessionId` — результат остаётся в истории нужной сессии и появляется при переключении. `abortControllers: Map<sessionId, AbortController>` — каждый процесс отменяется независимо (`cancelRequest` с `sessionId`), что позволяет параллельные запуски в разных сессиях. `switchToSession(sessionId)` — публичный метод переключения активной сессии (вызывается из вкладки «История» по двойному клику).
- **История со старта + индикатор «в работе»:** запуск записывается в историю сразу (`recordRunStart`, статус `running`), по завершении обновляется (`finalizeRun` → `success`/`error`/`cancelled`). Охвачены все режимы: чат/агент (`handleSendMessage`), Plan Mode (`handlePlanMode`/`handleImplementPlan`), оркестратор (`handleOrchestrate`). В Plan Mode `handleSendMessage` НЕ записывает запуск (иначе двойная запись — `handlePlanMode` пишет свой). `broadcastRunState` шлёт WebView `runStarted`/`runEnded` (без тега `sessionId`, поле `runSessionId` — чтобы WebView получил независимо от активной сессии); WebView показывает индикатор ⏹️ «в работе» при возврате в сессию с активным процессом.
- **Сигнал отмены Plan Mode:** `handlePlanMode` получает `signal` напрямую параметром (`abortController.signal` из `handleSendMessage`), а не через `abortControllers.get(sessionId)` — исключает гонку, когда в одной сессии несколько параллельных запусков перезаписывают контроллер в Map (приводило к «Request was aborted»). `implementPlan` передаёт `sessionId` (кнопка «Имплементировать»).
- **Персистентность результата Plan Mode:** план (`handlePlanMode`), имплементация и рефлексия (`handleImplementPlan`) сохраняются в историю сессии через `addMessageTo` — иначе при переключении чата/восстановлении (`restoreHistory`) результат терялся. `planGenerated` несёт исходную `sessionId`; WebView хранит её в `plan-container.dataset.sessionId`, а кнопка «Имплементировать» шлёт эту исходную сессию (а не `sessionSelect.value`) — результат уходит в сессию, где был запущен план, даже после переключения чатов.
- **Автокомплит команд:** при `ready` (инициализация WebView) отправляет `{ type: 'slashCommands', items: [{name, description, kind, prefix}] }` — встроенные слэш-команды (`SLASH_COMMANDS`, `prefix: '/'`), скилы (`getSkillCatalog()`, `prefix: '/'`) и `@orchestrate` (`prefix: '@'`). WebView показывает попап автокомплита при вводе `/` или `@`.
- **Session-log (F1):** конструктор принимает опциональный `sessionLog`. В `runAgentLoop` в `AgentWorker` передаются `sessionId` + `onEvent: e => sessionLog.append(e)` (персист `tool/call`, `tool/result`, `assistant/message`). В стриминговых ветках (chat + vision) `logStreamChunk`/`finalizeStream` пишут `assistant/chunk` (троттлинг по ~200 симв.) и `assistant/message`. `logUserMessage` пишет `user/message` при добавлении пользовательского сообщения (chat + vision). `resolveSessionId` разрешает активную сессию при `sessionId === undefined`.

## Тесты

- `chatViewProvider.test.ts` — полный мок vscode/ProviderManager/LLM/AgentOrchestrator/PlanModeManager: `handleSendMessage` напрямую (chat/agent/planMode/orchestrate), сессионная маршрутизация, история со старта (`running` → `success`), отсутствие двойной записи в Plan Mode, ошибка агента без `createWithTools`, персистентность плана/имплементации/рефлексии (`handlePlanMode`/`handleImplementPlan` → `addMessageTo`).
- `chatWebview.test.ts` (jsdom) — DOM-харнесс WebView: маршрутизация по sessionId, git-diff диалог подтверждения (рендер + кнопка «Подтвердить»), автокомплит `/`, индикатор «в работе», треджинг исходной сессии `planGenerated` → кнопка «Имплементировать».
- AgentWorker тесты (runAgentLoop)
- ConversationManager тесты (история)
- Ручное тестирование (20-пунктовый чек-лист)

## История изменений

| Версия | Дата | Изменения |
|--------|------|-----------|
| 0.10.0 | 2026-08-20 | Фикс: результат Plan Mode персистится в сессию + кнопка «Имплементировать» шлёт исходную sessionId (не текущую) — результат не теряется при переключении чатов |
| 0.10.0 | 2026-08-20 | `computeLineDiff` (git-diff диалога) вынесен в `lineDiff.js` (инлайнится в index.html через `{{LINEDIFF}}`) |
| 0.10.0 | 2026-08-19 | Автокомплит команд: sendSlashCommandsToWebview (встроенные + скилы + @orchestrate, поле prefix) |
| 0.9.0 | 2026-08-18 | Слэш-команды код-действий: /explain, /explain_stepbystep, /doc, /test, /review, /improve (интеграция SlashCommands) |
| 0.9.0 | 2026-08-11 | Фикс: каталог скилов (getSkillTemplate) в getSystemPrompt() для agent-режима |
| 0.9.0 | 2026-08-11 | Фикс: Plan Mode сохраняет сообщение пользователя в историю |
| 0.9.0 | 2026-08-09 | SkillsLoader: инжект скилов в getSystemPrompt() |
| 0.9.0 | 2026-08-08 | Plan Mode: ветвление handleSendMessage → PlanModeManager, переключатель UI |
| 0.8.0 | 2026-08-06 | Делегирование в AgentWorker, loadOrchestratorRoles, MCP для оркестратора |
| 0.7.0 | 2026-08-05 | @orchestrate, RunHistoryStore |
| 0.11.3 | 2026-08-22 | F1 (SL-5): sessionLog — персист assistant/chunk (троттлинг) + assistant/message в стриминге; onEvent в AgentWorker |
| 0.11.3 | 2026-08-22 | F1 (Этап 2): logUserMessage — эмиссия user/message в session-log |
| 0.11.3 | 2026-08-22 | F1 (Этап 3): steps в RunHistoryStore из лога (computeStats) + фикс sessionId агент-режима |
| 0.1.0 | 2026-08-04 | Базовая реализация |
