---
document: ARCHITECTURE
version: 0.14.58
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
│   ├── OllamaProvider            [spec ✅ beta] — нативный /api/chat: think, num_predict, /api/tags, /api/show, /api/ps; предупреждение об обрезке промпта (окно = context_length/2), первый байт ждётся по local.requestTimeout, 30 с — только discovery
│   ├── isLocalBaseUrl()          [base.ts] — локальность по АДРЕСУ (loopback): второй движок llama.cpp/LM Studio/vLLM через type: "openai"
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
│   │   ├── ModelRouter            [spec ✅] — прогноз стоимости, лимит бюджета сессии, авто-выбор модели по сложности (routing.*)
│   ├── SearchIndex               [spec ✅ beta] — локальный FTS5-индекс кодовой базы (BM25, вес пути), деградация к ripgrep; контракт search_files не меняет
│   ├── SearchIndexer             [spec ✅ beta] — обход, фильтры, детект не-текста, пачки, инкремент
│   ├── SearchRouter              [spec ✅ beta] — роутинг запроса (идентификатор → ripgrep, фраза → FTS) и склейка выдачи
│   ├── IndexService              [spec ✅ beta] — фоновая сборка, watcher, провайдер выдачи, команда пересборки
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
│   ├── ✏️ Edit Mode (Ctrl+Alt+I)
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

## Приёмка поиска (P8)

Индекс `search_files` нельзя оценить юнит-тестами: они проверяют механику (схема, запрос, склейка),
а вопрос «находит ли он нужный файл» решается только замером на наборе запросов с эталоном.

| Файл | Роль | Что важно |
|------|------|-----------|
| `scripts/acceptance/queries.json` | Эталон | 60 запросов с ожидаемыми файлами (14 из реальной переписки, 21 из бэклога, 25 из кода) + 5 негативных; `sha256` печатается в отчёте |
| `scripts/acceptance/run.js` | Замер | Три бэкенда в одном прогоне: `grepAnd` (все слова обязательны), `keywordOr` (grep + счёт), `index` (FTS5) и `indexFiltered` (то же, что видит агент — с порогом слабых попаданий) |
| `scripts/acceptance/check.js` | Гейт CI | Числа сравниваются с порогами: recall@5 ≥ 58%, strict@5 ≥ 30%, MRR ≥ 0.45, P@1 ≥ 30%, ноль уверенных совпадений на негативных |

**Метрики.** `recall@5` — ожидаемый файл в первой пятёрке (с интервалом Уилсона: на 30–60 запросах
разница в 10 п.п. — шум); `strict@5` — по первичному файлу, когда ответов несколько; `MRR` и `P@1` —
про качество ранжирования, а не полноту; негативные считаются долей непустых выдач и долей
уверенных совпадений.

**Что замерено (11.11, `vscode-llm-assistant` 275 файлов, 60 запросов):** `index` recall@5 75%,
strict@5 40%, MRR 0.60, P@1 50%; `keywordOr` — 78%, 33%, 0.33, 10%. То есть выигрыш индекса
в ранжировании, а не в полноте: по recall@5 интервалы пересекаются.

**Границы применимости.** Замер сделан на своём корпусе, где запросы и код на одном языке.
На чужой кодовой базе (`openai/openai-node`, 1263 файла) те же вопросы по-английски дают 65%,
по-русски — 20% (с порогом — пусто): качество зависит от языка запроса относительно языка кода.
Расширение порогов или движка без нового замера — регресс, а не улучшение.

**Запуск:** `npm run compile && npm run check:acceptance` (в CI — шаг в job `test-unit`);
второй корпус — `node scripts/acceptance/run.js --corpus=<путь> --queries=<файл> [--lang=en]`.

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
| `test/support/{fakes,vscode-harness}.ts` | Обвязка тестов | Двойники доменных типов и типизированный доступ к моку `vscode`; бюджет `as any` — `scripts/test-any-count.js` |
| `scripts/mutation-check.js` + `test/mutations.json` | Мутационная проверка тестов | Правит одну строку в `src`, гоняет юниты; зелёные тесты = поведение не покрыто; мутация без компиляции — «неприменима» |
| `scripts/acceptance/` | Приёмка поиска | `queries.json` (эталон), `run.js` (замер трёх бэкендов), `check.js` (гейт CI) |
| `scripts/copy-sqlite-assets.js` | Упаковка WASM | Кладёт `node.mjs`, `index.mjs`, `sqlite3.wasm` в `dist/sqlite` после webpack (`clean: true`) |
| `scripts/smoke-vsix-index.js` | Смоук артефакта | Активирует собранный бандл из распакованного VSIX и ждёт создания индекса |

## История изменений

| Версия | Дата | Изменения |
|--------|------|-----------|
| 0.14.58 | 2026-11-11 | Мутационная проверка тестов в инфраструктуре: `scripts/mutation-check.js`, `test/mutations.json`, еженедельный workflow |
| 0.14.57 | 2026-11-11 | Раздел «Приёмка поиска»: эталон на 60 запросов, четыре бэкенда в одном прогоне, метрики с интервалами, гейт в CI, границы применимости (язык запроса); в инфраструктуру добавлены `scripts/acceptance/`, `copy-sqlite-assets.js`, `smoke-vsix-index.js` |
| 0.14.56 | 2026-11-11 | `SearchIndexer`, `SearchRouter`, `IndexService` в карте; `search_files` получил роутинг без изменения контракта |
| 0.14.55 | 2026-11-11 | `SearchIndex` в карте компонентов: локальный FTS5-индекс для `search_files` (S1: нормализация, схема, запрос, экспорт/импорт) |
| 0.14.54 | 2026-11-10 | `ModelRouter` в карте компонентов (прогноз стоимости, лимит сессии, авто-выбор модели); описание `OllamaProvider` приведено к факту: `/api/ps`, окно = `context_length/2`, первый байт по `local.requestTimeout`, 30 с — только discovery |
| 0.14.53 | 2026-11-09 | Порог предупреждения об обрезке промпта исправлен на реальную границу `numCtx/2` (`effectivePromptWindow`); e2e-покрытие `E2E-3..E2E-9` в реальном Extension Host (42 e2e, 611 юнит) |
| 0.14.51 | 2026-11-09 | E2E для локального пути в реальном Extension Host (`E2E-1`, `E2E-2`); хост-раннер собирает e2e из каталога вместо захардкоженного списка |
| 0.14.46 | 2026-11-09 | Локальность по адресу (`isLocalBaseUrl`), второй локальный движок (llama.cpp) без новых настроек, `title` и override-поля в записи провайдера, диагностика обрезки промпта, таймаут соединения 10 с |
| 0.14.0 | 2026-11-07 | +OllamaProvider (planned): нативный /api/chat вместо /v1, type в конфиге провайдера, локальные цены 0, isLocal |
| 0.13.0 | 2026-08-23 | +thinking.ts, SessionLog, PlanModeManager, SlashCommands, HistoryViewProvider в карту; сайдбар/toolbar/activity-feed/тумблеры; autocomplete async + thinking; 38 компонентов; убран jest.config.js (Mocha); agent max 20 |
| 0.8.0 | 2026-08-06 | Первая версия мастер-спецификации |
