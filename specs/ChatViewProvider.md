---
component: ChatViewProvider
version: 0.8.0
status: stable
since: 0.1.0
---

## Назначение

Главный WebView-хаб расширения. Обрабатывает все сообщения из чата: чат, агент, vision, @orchestrate. Делегирует AgentWorker для ReAct-цикла.

## Интерфейс

### `new ChatViewProvider(ctx, providerManager, conversationManager, runHistoryStore, historyViewProvider?, orchestratorViewProvider?)`

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
- **Автокомплит команд:** при `ready` (инициализация WebView) отправляет `{ type: 'slashCommands', items: [{name, description, kind, prefix}] }` — встроенные слэш-команды (`SLASH_COMMANDS`, `prefix: '/'`), скилы (`getSkillCatalog()`, `prefix: '/'`) и `@orchestrate` (`prefix: '@'`). WebView показывает попап автокомплита при вводе `/` или `@`.


## Тесты

Прямых юнит-тестов нет. Покрывается интеграционно через:
- AgentWorker тесты (runAgentLoop)
- ConversationManager тесты (история)
- Ручное тестирование (20-пунктовый чек-лист)

## История изменений

| Версия | Дата | Изменения |
|--------|------|-----------|
| 0.9.0 | 2026-08-18 | Слэш-команды код-действий: /explain, /explain_stepbystep, /doc, /test, /review, /improve (интеграция SlashCommands) |
| 0.10.0 | 2026-08-19 | Автокомплит команд: sendSlashCommandsToWebview (встроенные + скилы + @orchestrate, поле prefix) |
| 0.9.0 | 2026-08-11 | Фикс: каталог скилов (getSkillTemplate) в getSystemPrompt() для agent-режима |
| 0.9.0 | 2026-08-11 | Фикс: Plan Mode сохраняет сообщение пользователя в историю |
| 0.9.0 | 2026-08-09 | SkillsLoader: инжект скилов в getSystemPrompt() |
| 0.9.0 | 2026-08-08 | Plan Mode: ветвление handleSendMessage → PlanModeManager, переключатель UI |
| 0.8.0 | 2026-08-06 | Делегирование в AgentWorker, loadOrchestratorRoles, MCP для оркестратора |
| 0.7.0 | 2026-08-05 | @orchestrate, RunHistoryStore |
| 0.1.0 | 2026-08-04 | Базовая реализация |
