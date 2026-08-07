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
- `mode='agent'` → проверка `createWithTools` → `runAgentLoop()`
- `mode='chat'` → `provider.chat(stream)`
- Vision → `provider.chatWithVision()`

### `runAgentLoop(provider, model, messages)` → делегирует `AgentWorker.run()`

### `handleOrchestrate(taskText, provider, model)` → `AgentOrchestrator.execute()`

### `recordChatRun()` — запись в `RunHistoryStore` с `calculateCost()`

## Контракты

| Ситуация | Поведение |
|----------|-----------|
| Провайдер не поддерживает `createWithTools` | Ошибка «не поддерживает режим Агента» |
| `@orchestrate` вне агентного режима | Игнорируется |
| Vision + нет `supportsVision` | Ошибка |
| MCP-сервер недоступен | Лог в debugChannel, агент работает без MCP |
| Контекст кода | `attachCodeContext` ДО `addMessage` |

## Связи

- **Использует:** ProviderManager, ConversationManager, AgentWorker, AgentOrchestrator, McpClient, RunHistoryStore
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


## Тесты

Прямых юнит-тестов нет. Покрывается интеграционно через:
- AgentWorker тесты (runAgentLoop)
- ConversationManager тесты (история)
- Ручное тестирование (20-пунктовый чек-лист)

## История изменений

| Версия | Дата | Изменения |
|--------|------|-----------|
| 0.8.0 | 2026-08-06 | Делегирование в AgentWorker, loadOrchestratorRoles, MCP для оркестратора |
| 0.7.0 | 2026-08-05 | @orchestrate, RunHistoryStore |
| 0.1.0 | 2026-08-04 | Базовая реализация |
