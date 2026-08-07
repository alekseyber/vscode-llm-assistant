---
document: ARCHITECTURE
version: 0.8.0
status: living
---

# Архитектура VS Code LLM Assistant

Мастер-спецификация: карта компонентов, потоки данных, точки расширения.

## Карта компонентов

```
extension.ts (вход)
├── activation/registerCommands.ts (регистрация команд и вкладок)
│
├── ПРОВАЙДЕРЫ
│   ├── ProviderManager          [spec ✅] — управление LLM-провайдерами
│   ├── OpenAIProvider            [spec ❌] — OpenAI-совместимый API
│   ├── BaseProvider              [spec ❌] — абстрактный класс
│   └── types.ts (частично ✅)   — ModelPricing, calculateCost
│
├── РЕЖИМЫ
│   ├── 💬 Чат
│   │   ├── ChatViewProvider      [spec ❌] — главный WebView-хаб (569 строк)
│   │   ├── ConversationManager   [spec ❌] — история + контекст + summary
│   │   ├── SessionManager        [spec ❌] — мульти-сессии (crypto.randomUUID)
│   │   └── ChatAgentTools        [spec ✅] — 6 инструментов (read/write/search/terminal)
│   │
│   ├── 🤖 Агент (ReAct через чат)
│   │   ├── AgentWorker           [spec ✅] — общий ReAct-движок
│   │   ├── AgentOrchestrator     [spec ✅] — multi-agent (parallel/seq/pipeline)
│   │   ├── AgentSharedContext    [spec ❌] — артефакты между воркерами
│   │   ├── OrchestratorViewProv  [spec ❌] — вкладка «🎭 Оркестратор»
│   │   └── McpClient             [spec ❌] — подключение MCP-серверов
│   │
│   ├── 🔧 Apply Mode (отдельная команда)
│   │   ├── AgentController       [spec ❌] — JSON-парсинг, без function calling
│   │   ├── ToolSystem            [spec ❌] — реестр инструментов (не ChatAgentTools!)
│   │   └── ToolDefinitions       [spec ❌] — createTools() (7 инструментов)
│   │
│   ├── ✏️ Edit Mode (Ctrl+I)
│   │   ├── EditController        [spec ❌] — inline diff
│   │   └── diff.ts               [spec ❌] — вычисление diff
│   │
│   └── 👻 Автокомплит
│       ├── AutocompleteController [spec ❌] — ghost text
│       ├── ContextBuilder         [spec ❌] — prefix/suffix из редактора
│       └── GhostTextManager       [spec ❌] — отображение
│
├── ИСТОРИЯ
│   ├── RunHistoryStore           [spec ❌] — FIFO-хранилище запусков (100 записей)
│   └── HistoryViewProvider       [spec ❌] — вкладка «📊 История»
│
├── SHARED
│   ├── ContextSummarizer         [spec ❌] — сжатие истории в summary
│   ├── RetryHandler              [spec ❌] — exponential backoff + jitter
│   ├── AgentsMdLoader            [spec ❌] — загрузка .llma/main.md
│   ├── RoleAgentsMdLoader        [spec ✅] — .llma/agents/{role}.md + @orchestrate роли
│   ├── ToolAllowList             [spec ❌] — фильтрация инструментов
│   ├── RunHistoryStore           [spec ❌] — FIFO 100 записей
│   ├── streaming.ts              [spec ❌] — SSE-парсинг
│   └── logger.ts                 [spec ❌] — логирование
│
└── WEBVIEW
    ├── index.html                — разметка чата
    ├── main.js                   — логика WebView (сообщения, сессии, Markdown)
    └── styles.css                — стили
```

## Покрытие спецификациями

| Статус | Компоненты |
|--------|-----------|
| ✅ Есть spec | AgentWorker, AgentOrchestrator, ProviderManager, ChatAgentTools, RoleAgentsMdLoader |
| ❌ Нет spec | ChatViewProvider, ConversationManager, SessionManager, ContextSummarizer, AgentController, RetryHandler, ToolAllowList, McpClient, RunHistoryStore, HistoryViewProvider, OpenAIProvider, EditController, AutocompleteController, Streaming, +5 |

**Покрытие: 5/25 (20%)**

## Потоки данных

### 💬 Чат

```
Пользователь → WebView (main.js)
  → postMessage('sendMessage')
  → ChatViewProvider.handleSendMessage()
    → ConversationManager.addMessage(user)
    → ConversationManager.getMessagesForRequest()
      → buildHistoryWithTrimmed()  // учёт токенов
      → [summary] если обрезано > 256 токенов
    → provider.chat(messages, stream)
    → WebView: streamChunk → renderMarkdown
    → ConversationManager.addMessage(assistant)
```

### 🤖 Агент

```
Пользователь → WebView
  → ChatViewProvider.handleSendMessage(mode='agent')
    → проверка createWithTools
    → MCP-подключение
    → AgentWorker.run(task, messages)
      → ReAct-цикл (max 5)
        → createWithTools → tool_calls
        → onConfirm (write_file/terminal)
        → tool.execute()
      → финальный ответ
    → WebView: streamChunk + done
```

### 🎭 @orchestrate

```
Пользователь → WebView
  → ChatViewProvider.handleOrchestrate()
    → loadOrchestratorRoles()  // .llma/agents/*.md
    → MCP-подключение
    → AgentOrchestrator.execute(task, provider, mcpTools)
      → sequential: architect → coder → reviewer
        → AgentWorker.run(subTask)
      → результат → WebView
```

### 🔧 Apply Mode

```
Пользователь → Command Palette → "LLM Assistant: Apply Mode"
  → InputBox (задача)
  → AgentController.run()
    → provider.chat(temperature=0)  // без function calling!
    → JSON-парсинг ответа: {tool, arguments}
    → ToolSystem.execute()
    → Output Channel (логирование)
```

## Зависимости: кто кого использует

```
ChatViewProvider
  ├── ProviderManager          (провайдеры)
  ├── ConversationManager      (история)
  ├── AgentWorker              (ReAct-агент)
  ├── AgentOrchestrator        (оркестратор)
  ├── McpClient                (MCP)
  ├── ContextSummarizer        (было, убрано в 0.8.0)
  └── AgentsMdLoader           (правила)

AgentWorker
  ├── ChatAgentTools           (инструменты)
  ├── ContextSummarizer        (summary)
  └── RoleAgentsMdLoader       (ролевые правила)

AgentOrchestrator
  ├── AgentWorker              (воркеры)
  └── AgentSharedContext       (артефакты)

ConversationManager
  ├── SessionManager           (сессии)
  └── ContextSummarizer        (summary)

AgentController (Apply Mode)
  ├── ToolSystem               (реестр инструментов)
  └── ContextSummarizer        (summary)
```

## Точки расширения

| Что расширяем | Как | Пример |
|--------------|-----|--------|
| Новый провайдер | Добавить в `llmAssistant.providers` settings.json | `"groq": { baseUrl, apiKey, models }` |
| Новый инструмент | `ChatAgentTools.ts` → `CHAT_AGENT_TOOLS` | `git_commit`, `run_tests` |
| Новая роль @orchestrate | `.llma/agents/tester.md` | Авто-обнаружение |
| MCP-сервер | `.vscode/mcp.json` → `McpClient` | `@anthropic/mcp-server-git` |
| Новый режим | `registerCommands.ts` + новый контроллер | `Diff Mode`, `Review Mode` |
| Allow-list | `.vscode/llm-assistant.json` | `allowedTools`, `requireConfirmation` |

## Размеры компонентов

| Компонент | Строк | Ответственность |
|-----------|-------|----------------|
| ChatViewProvider.ts | 569 | Главный хаб: чат, агент, оркестратор, vision |
| AgentController.ts | 443 | Apply Mode: свой ReAct + JSON-парсинг |
| AgentWorker.ts | 282 | Общий ReAct-движок |
| AgentOrchestrator.ts | 255 | Multi-agent оркестрация |
| ChatAgentTools.ts | 235 | 6 инструментов |
| ConversationManager.ts | 209 | История, контекст, summary |
| OpenAIProvider.ts | 230 | API-клиент + ретраи |
| RetryHandler.ts | ~200 | Exponential backoff |
| registerCommands.ts | 386 | Регистрация всех команд |

## Долг (технический)

| Проблема | Приоритет |
|----------|-----------|
| AgentController — дублирующийся ReAct (JSON-парсинг вместо function calling) | Средний |
| ToolSystem и ChatAgentTools — два реестра инструментов | Средний |
| ChatViewProvider 569 строк — кандидат на разделение | Низкий |
| 20/25 компонентов без spec | Высокий |
| MA-6 (делегирование), MA-7 (cost tracking per agent) — не сделаны | Средний |

## История изменений

| Версия | Дата | Изменения |
|--------|------|-----------|
| 0.8.0 | 2026-08-06 | Первая версия мастер-спецификации |
