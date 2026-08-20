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
│   ├── OpenAIProvider            [spec ✅] — OpenAI-совместимый API
│   ├── BaseProvider              [spec ✅] — абстрактный класс
│   └── types.ts (частично ✅)   — ModelPricing, calculateCost
│
├── РЕЖИМЫ
│   ├── 💬 Чат
│   │   ├── ChatViewProvider      [spec ✅] — главный WebView-хаб (569 строк)
│   │   ├── ConversationManager   [spec ✅] — история + контекст + summary
│   │   ├── SessionManager        [spec ✅] — мульти-сессии (crypto.randomUUID)
│   │   ├── ChatAgentTools        [spec ✅] — 9 инструментов (read/write/search/terminal/delegate/web_fetch/ask_user)
│   │   ├── AskUserTool            [spec ✅ ← 0.9.0] — уточняющие вопросы (QuickPick/InputBox)
│   │
│   ├── 🤖 Агент (ReAct через чат)
│   │   ├── AgentWorker           [spec ✅] — общий ReAct-движок
│   │   ├── AgentOrchestrator     [spec ✅] — multi-agent (parallel/seq/pipeline)
│   │   ├── AgentSharedContext    [spec ✅] — артефакты между воркерами
│   │   ├── OrchestratorViewProv  [spec ✅] — вкладка «🎭 Оркестратор»
│   │   └── McpClient             [spec ✅] — подключение MCP-серверов
│   │
│   ├── 🔧 Apply Mode (отдельная команда)
│   │   ├── AgentController       [spec ✅] — JSON-парсинг, без function calling
│   │   ├── ToolSystem            [spec ✅] — реестр инструментов (не ChatAgentTools!)
│   │   └── ToolDefinitions       [spec ✅] — createTools() (5 инструментов)
│   │
│   ├── ✏️ Edit Mode (Ctrl+I)
│   │   └── EditController        [spec ✅] — inline diff
│   │
│   ├── 💡 Code Actions (0.9.0)
│   │   └── CodeActionsProvider   [spec ✅] — лампочка: «Объясни», «Почини», «Спроси»
│   │
│   ├── 🔍 Ревью (0.11.0)
│   │   ├── CodeReviewer          [spec ✅] — standalone AI-ревью (reviewFile/reviewCode через ReviewerAgent)
│   │   ├── ReviewViewProvider    [spec ✅] — вкладка «Ревью» (компактная сводка)
│   │   └── ReviewPanel           [spec ✅] — широкое окно полного отчёта
│   │
│   └── 👻 Автокомплит
│       └── AutocompleteController [spec ✅] — ghost text (ContextBuilder + GhostTextManager)
│
├── ИСТОРИЯ
│   ├── RunHistoryStore           [spec ✅] — FIFO-хранилище запусков (100 записей)
│   └── HistoryViewProvider       [spec ✅] — вкладка «📊 История»
│
├── SHARED
│   ├── ContextSummarizer         [spec ✅] — сжатие истории в summary
│   ├── DiagnosticsProvider       [spec ✅ ← 0.9.0] — автосбор ошибок как контекст
│   ├── StatusBarIndicator        [spec ✅ ← 0.9.0] — индикатор в статус-баре
│   ├── DecorationsManager        [spec ✅ ← 0.9.0] — подсветка изменённых строк
│   ├── RetryHandler              [spec ✅] — exponential backoff + jitter
│   ├── AgentsMdLoader            [spec ✅] — загрузка .llma/main.md
│   ├── RoleAgentsMdLoader        [spec ✅] — .llma/agents/{role}.md + @orchestrate роли
│   ├── SkillsLoader              [spec ✅ ← 0.9.0] — загрузка .llma/skills/*.md
│   ├── ToolAllowList             [spec ✅] — фильтрация инструментов
│   ├── streaming.ts              [spec ✅] — SSE-парсинг
│   └── logger.ts                 [spec ✅] — логирование
│
│   └── WEBVIEW
│       ├── index.html            — разметка чата
│       ├── main.js               — логика (912 строк)
│       ├── styles.css            — стили
│       └── WebView                [spec ✅] — полная спецификация
```

## Покрытие спецификациями

| Статус | Компоненты |
|--------|-----------|
|| ✅ Есть spec | **34 компонента** |

**Покрытие: 34/34 (100%)**

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
  ├── AgentsMdLoader           (правила)
  └── SkillsLoader             (скилы)

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
| Новый скил | `.llma/skills/python-testing.md` | Авто-обнаружение + автоинжект |
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
| MA-6 (делегирование), MA-7 (cost tracking per agent) — сделаны в v0.8.1 |

## Инфраструктура (файлы без spec)

Эти файлы критичны для понимания проекта, но не являются компонентами:

| Файл | Назначение | Ключевые детали |
|------|-----------|-----------------|
| `package.json` | Скрипты и зависимости | `npm run compile` (webpack), `lint`, `test:mocked`, `test` |
| `tsconfig.json` | Компиляция src | `strict: true`, `module: commonjs`, `target: ES2020` |
| `tsconfig.test.json` | Компиляция тестов | `rootDir: .`, `include: ["test/**/*.ts"]` |
| `webpack.config.js` | Бандл расширения | `target: node`, `entry: ./src/extension.ts` |
| `jest.config.js` | Конфиг тестов | `testMatch: src/**/*.test.ts`, `preset: ts-jest` |
| `.vscode/launch.json` | F5-dev запуск | `Run Extension` (preLaunch: compile), `Extension Tests` |
| `AGENTS.md` | Инструкции для LLM | Ссылка на specs/, TEMPLATE, язык, SDD-процесс |
| `.llma/` | Агенты для @orchestrate | `agents/*.md`: префиксы → цепочка, без → делегирование |

## История изменений

| Версия | Дата | Изменения |
|--------|------|-----------|
| 0.8.0 | 2026-08-06 | Первая версия мастер-спецификации |
