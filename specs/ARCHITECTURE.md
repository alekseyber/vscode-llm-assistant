---
document: ARCHITECTURE
version: 0.13.0
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
│   ├── ProviderManager          [spec ✅] — управление LLM-провайдерами (fallback на первый настроенный)
│   ├── OpenAIProvider            [spec ✅] — OpenAI-совместимый API (+ extraBody в тело запроса)
│   ├── BaseProvider              [spec ✅] — абстрактный класс
│   └── types.ts (частично ✅)   — ModelPricing, calculateCost, CompletionOptions.extraBody
│
├── РЕЖИМЫ
│   ├── 💬 Чат
│   │   ├── ChatViewProvider      [spec ✅] — главный WebView-хаб (сайдбар, toolbar, activity-feed, тумблеры)
│   │   ├── ConversationManager   [spec ✅] — история + контекст + summary
│   │   ├── SessionManager        [spec ✅] — мульти-сессии (crypto.randomUUID)
│   │   ├── SessionLog            [spec ✅] — append-only лог (единственный источник правды, F1)
│   │   ├── ChatAgentTools        [spec ✅] — инструменты чат-агента (read/write/replace/list/search/terminal/delegate)
│   │   ├── AskUserTool            [spec ✅] — уточняющие вопросы (QuickPick/InputBox)
│   │   └── PlanModeManager        [spec ✅] — Plan Mode (план → имплементация → рефлексия)
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
│   │   └── ToolDefinitions       [spec ✅] — createTools() (read/write/patch/search/terminal/web_fetch)
│   │
│   ├── ✏️ Edit Mode (Ctrl+I)
│   │   └── EditController        [spec ✅] — inline diff
│   │
│   ├── 💡 Code Actions
│   │   └── CodeActionsProvider   [spec ⏳ planned] — лампочка (запланировано, не реализовано)
│   │
│   ├── 🔍 Ревью
│   │   ├── CodeReviewer          [spec ✅] — standalone AI-ревью (reviewFile/reviewCode через ReviewerAgent)
│   │   ├── ReviewViewProvider    [spec ✅] — вкладка «Ревью» (компактная сводка)
│   │   └── ReviewPanel           [spec ✅] — широкое окно полного отчёта
│   │
│   └── 👻 Автокомплит
│       └── AutocompleteController [spec ✅] — ghost text (async-провайдер + ContextBuilder + GhostTextManager)
│
├── ИСТОРИЯ
│   ├── RunHistoryStore           [spec ✅] — FIFO-хранилище запусков (100 записей)
│   └── HistoryViewProvider       [spec ✅] — вкладка «📊 История» (клик/двойной клик)
│
├── SHARED
│   ├── ContextSummarizer         [spec ✅] — сжатие истории в summary
│   ├── DiagnosticsProvider       [spec ⏳ planned] — автосбор ошибок (запланировано)
│   ├── StatusBarIndicator        [spec ⏳ planned] — индикатор в статус-баре (запланировано)
│   ├── DecorationsManager        [spec ⏳ planned] — подсветка изменённых строк (частично в diff.ts)
│   ├── RetryHandler              [spec ✅] — exponential backoff + jitter
│   ├── AgentsMdLoader            [spec ✅] — загрузка .llma/main.md
│   ├── RoleAgentsMdLoader        [spec ✅] — .llma/agents/{role}.md + @orchestrate роли
│   ├── SkillsLoader              [spec ✅] — загрузка .llma/skills/*.md
│   ├── ToolAllowList             [spec ✅] — фильтрация инструментов
│   ├── streaming.ts              [spec ✅] — SSE-парсинг
│   ├── thinking.ts               [spec ✅] — отключение reasoning у deepseek (extraBody)
│   └── logger.ts                 [spec ✅] — логирование (Output Channel)
│
│   └── WEBVIEW
│       ├── index.html            — разметка чата (сайдбар, toolbar, input-toolbar)
│       ├── main.js               — логика (1605 строк)
│       ├── styles.css            — стили (оверлей-дроверы, activity-feed)
│       ├── toolbar.js            — data-driven toolbar (⋮ overflow)
│       ├── toolActivity.js       — activity-feed (френдли-шаги)
│       ├── lineDiff.js           — LCS-диф для подтверждений
│       └── WebView                [spec ✅] — полная спецификация
```

## Покрытие спецификациями

| Статус | Компоненты |
|--------|-----------|
| ✅ Реализован + spec | **34 компонента** |
| ⏳ Запланирован (spec без кода) | 4: CodeActionsProvider, DecorationsManager, DiagnosticsProvider, StatusBarIndicator |

**Покрытие реализованного кода: 34/34 (100%).** Мета-документы: ARCHITECTURE, TRACEABILITY, TEMPLATE.

## Потоки данных

### 💬 Чат

```
Пользователь → WebView (main.js)
  → postMessage('sendMessage')
  → ChatViewProvider.handleSendMessage()
    → SessionLog.addMessage(user)          // append-only лог
    → ConversationManager.getMessagesForRequest()
      → buildHistoryWithTrimmed()  // учёт токенов
      → [summary] если обрезано > 256 токенов
    → provider.chat(messages, stream, {extraBody})   // thinking disabled по настройке
    → WebView: streamChunk → renderMarkdown
    → SessionLog.addMessage(assistant)
```

### 🤖 Агент

```
Пользователь → WebView
  → ChatViewProvider.handleSendMessage(mode='agent')
    → проверка createWithTools
    → MCP-подключение
    → AgentWorker.run(task, messages)
      → ReAct-цикл (max 20)
        → createWithTools → tool_calls
        → onConfirm (write_file/terminal)
        → tool.execute() → tool/call + tool/result в SessionLog
      → финальный ответ
    → WebView: activity-feed (френдли-шаги) + done + свёрнутый трейс
```

### 📋 Plan Mode

```
Пользователь → WebView → тумблер «План»
  → PlanModeManager.start()
    → планирование (план в .llma/plans/)
    → имплементация (AgentOrchestrator: architect → coder)
    → рефлексия (ReviewerAgent проверяет AC)
    → результат персистится в SessionLog
  → WebView: done перед reflectReport (стрим корректно финализируется)
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
  ├── SessionLog               (append-only лог)
  ├── AgentWorker              (ReAct-агент)
  ├── AgentOrchestrator        (оркестратор)
  ├── PlanModeManager          (Plan Mode)
  ├── McpClient                (MCP)
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
| ChatViewProvider.ts | 1062 | Главный хаб: чат, агент, оркестратор, plan mode, vision |
| AgentController.ts | 445 | Apply Mode: свой ReAct + JSON-парсинг |
| AgentWorker.ts | 356 | Общий ReAct-движок |
| ChatAgentTools.ts | 337 | Инструменты чат-агента |
| AgentOrchestrator.ts | 301 | Multi-agent оркестрация |
| openai.ts | 232 | API-клиент + ретраи + extraBody |
| registerCommands.ts | 556 | Регистрация всех команд |
| main.js | 1605 | Логика WebView (сайдбар, toolbar, activity-feed) |

## Долг (технический)

| Проблема | Приоритет |
|----------|-----------|
| AgentController — дублирующийся ReAct (JSON-парсинг вместо function calling) | Средний |
| ToolSystem и ChatAgentTools — два реестра инструментов | Средний |
| ChatViewProvider 1062 строк — кандидат на разделение | Средний |
| P3 — частичное принятие автокомплита (Tab=слово) не реализовано | Средний |
| Регрессионный прогон §6 ручного теста — на будущие релизы | Низкий |

## Инфраструктура (файлы без spec)

Эти файлы критичны для понимания проекта, но не являются компонентами:

| Файл | Назначение | Ключевые детали |
|------|-----------|-----------------|
| `package.json` | Скрипты и зависимости | `npm run compile` (webpack), `lint`, `test:mocked`, `test` |
| `tsconfig.json` | Компиляция src | `strict: true`, `module: commonjs`, `target: ES2020` |
| `tsconfig.test.json` | Компиляция тестов | `rootDir: .`, `include: ["test/**/*.ts"]` |
| `webpack.config.js` | Бандл расширения | `target: node`, `entry: ./src/extension.ts` |
| `test/run-mocked.js` | Mocked-тесты | Подменяет `vscode` на `test/mocks/vscode/`, Mocha |
| `.vscode/launch.json` | F5-dev запуск | `Run Extension` (preLaunch: compile), `Extension Tests` |
| `AGENTS.md` | Инструкции для LLM | Ссылка на specs/, TEMPLATE, язык, SDD-процесс |
| `.llma/` | Агенты для @orchestrate | `agents/*.md`: префиксы → цепочка, без → делегирование |

## История изменений

| Версия | Дата | Изменения |
|--------|------|-----------|
| 0.13.0 | 2026-08-23 | +thinking.ts, SessionLog, PlanModeManager, SlashCommands, HistoryViewProvider в карту; сайдбар/toolbar/activity-feed/тумблеры; autocomplete async + thinking; 38 компонентов; убран jest.config.js (Mocha); agent max 20 |
| 0.8.0 | 2026-08-06 | Первая версия мастер-спецификации |
