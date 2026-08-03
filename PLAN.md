# VS Code LLM Assistant (GigaCode-подобный) — План реализации

> **Цель:** Построить extension для VS Code, аналог GigaCode — диалог с LLM в режимах chat, edit, autocomplete, apply (агентный кодинг), с OpenAI-совместимым провайдером.

**Архитектура:** Extension на JS/TS (VS Code API) с WebView UI для чата, декорациями/ghost text для автокомплита, diff-редактором для edit-режима и ReAct-агентом для apply-режима. Провайдеры — OpenAI-совместимые (через единый интерфейс).

**Tech Stack:** TypeScript, VS Code Extension API, WebView API, Vanilla JS (чат), Webpack.

### Зависимости (npm packages)

Полный список пакетов, необходимых для проекта, с разбивкой по назначению и задачам.

#### Production (`dependencies`)

| Пакет | Версия | Зачем | Используется в |
|-------|--------|-------|----------------|
| `openai` | ^4.x | OpenAI SDK: HTTP-запросы к LLM API, стриминг (SSE), AbortSignal, retry | Задача 2 (Provider) |
| `marked` | ^12.x | Markdown → HTML для WebView чата (лёгкий, no deps) | Задача 3 (Chat WebView) |
| `highlight.js` | ^11.x | Подсветка синтаксиса кода в WebView | Задача 3 (Chat WebView) |

#### Development (`devDependencies`)

| Пакет | Версия | Зачем | Используется в |
|-------|--------|-------|----------------|
| `typescript` | ^5.x | Компиляция TS → JS | Задача 1 (Init) |
| `@types/vscode` | ^1.92.x | Типы VS Code Extension API | Задача 1 (Init) |
| `@types/node` | ^20.x | Типы Node.js (VS Code extension host) | Задача 1 (Init) |
| `webpack` | ^5.x | Сборка extension в один .js файл | Задача 1 (Init) |
| `webpack-cli` | ^5.x | CLI для webpack | Задача 1 (Init) |
| `ts-loader` | ^9.x | TypeScript → JS через webpack | Задача 1 (Init) |
| `@vscode/test-electron` | ^2.x | Запуск тестов в VS Code environment | Задача 9 (Testing) |
| `@vscode/vsce` | ^2.x | Публикация extension в Marketplace | Задача 10 (CI) |
| `mocha` | ^10.x | Тест-раннер (стандарт VS Code) | Задача 9 (Testing) |
| `@types/mocha` | ^10.x | Типы для mocha | Задача 9 (Testing) |
| `sinon` | ^18.x | Моки, стабы, spy для тестов | Задача 9 (Testing) |
| `@types/sinon` | ^17.x | Типы для sinon | Задача 9 (Testing) |
| `eslint` | ^9.x | Статический анализ кода | Задача 9 (Testing) |
| `@typescript-eslint/parser` | ^7.x | Парсинг TS для ESLint | Задача 9 (Testing) |
| `@typescript-eslint/eslint-plugin` | ^7.x | Правила ESLint для TS | Задача 9 (Testing) |
| `nyc` | ^17.x | Coverage отчёты (опционально) | Задача 9 (Testing) |

#### Прямые зависимости в WebView (bundled в extension)

Пакеты `marked` и `highlight.js` используются в WebView (фронтенд) и должны быть включены в сборку extension через webpack. Они не загружаются из CDN — всё идёт в составе .vsix.

#### Команды npm

```json
{
  "scripts": {
    "compile": "webpack --mode production",
    "watch": "webpack --mode development --watch",
    "lint": "eslint src/ test/",
    "test": "node ./out/test/runTest.js",
    "package": "vsce package",
    "publish": "vsce publish"
  }
}
```

#### Установка одной командой

```bash
npm install openai marked highlight.js
npm install --save-dev typescript @types/vscode @types/node webpack webpack-cli ts-loader \
  @vscode/test-electron @vscode/vsce mocha @types/mocha sinon @types/sinon \
  eslint @typescript-eslint/parser @typescript-eslint/eslint-plugin nyc
```

---

## Общие требования к коду и файлам

### Права доступа к файлам
Проект работает в Docker-контейнере, но файлы должны быть доступны на хост-машине (uid 1000).

- **Файлы** (все `.ts`, `.json`, `.md`, `.js`, `.css`, `.html`): `chmod 644`
- **Папки**: `chmod 755`

Каждый subagent/cronjob, создающий файлы, **обязан** выполнять chmod.

### Язык документации и комментариев
- **Весь код** комментируется на **русском языке**
- **README**, **CHANGELOG**, **commit messages** — на русском
- Имена переменных, функций, классов, типов — на **английском**
  ```typescript
  // Провайдер для OpenAI-совместимых API
  // Отправляет POST /v1/chat/completions с stream: true
  export class OpenAIProvider extends BaseProvider { ... }
  ```

### Актуальность PLAN.md
Перед стартом каждой задачи `PLAN.md` должен быть актуален в папке проекта. Любые изменения в плане, согласованные с пользователем, вносятся в PLAN.md **до** начала задачи. Subagent/cronjob читает PLAN.md как единственный источник требований.

### Git-репозиторий и работа с ветками

- **Репозиторий:** `git@github.com:alekseyber/vscode-llm-assistant.git`
- **Ветка:** `main` (одна ветка на весь проект)
- **Каждый этап** = отдельный коммит с сообщением на русском
- **Push только после проверки AC** — сначала все AC = PASS, потом `git push`
- **Никаких force-push** без согласования

### Версия VS Code

Extension должен быть совместим с **VS Code 1.131.0** (последняя стабильная на момент старта).

- В `package.json` → `engines.vscode`: `^1.131.0`
- `@types/vscode` в devDependencies: `^1.131.0`
- Используются только стабильные API, никаких proposedAPI

Каждая задача и каждая фаза имеет **Acceptance Criteria (DoD)**. Переход к следующему шагу возможен **только** если:

1. **Все AC текущего шага выполнены** — проверено тестами или вручную
2. **Все тесты проходят** — `npm test` (или `npm run test`) без ошибок
3. **Нет регрессий** — предыдущие фичи продолжают работать
4. **Код в git** — закоммичен с осмысленным сообщением на русском
5. **Права доступа** — все новые файлы имеют `644`, папки `755`
6. Если AC **не выполнены** → фикс проблем до перехода, без исключений

## Исполнение задач (Execution Model)

Каждая задача выполняется как **однократный cronjob** (durable background process).

### Протокол исполнения

```
Команда пользователя: "старт Задача N"
  → Я создаю cronjob (однократный, +1мин):
       prompt = секция "Задача N" из PLAN.md
       skills = [plan] (для чтения PLAN.md)
       deliver = origin (сюда в чат)
  → Cronjob запускается, читает PLAN.md, выполняет шаги
  → По завершению — отчёт: "Задача N выполнена. AC: ✅/❌. Gate: PASS/FAIL"
  → Я спрашиваю: "Перейти к Задаче N+1?"
```

### Правила для cronjob

1. **Чистый контекст** — cronjob не имеет доступа к истории диалога, только к PLAN.md
2. **Самодостаточность** — prompt содержит полную секцию задачи из PLAN.md
3. **Обязательные шаги в конце каждой задачи:**
   - Проверить все AC (Acceptance Criteria)
   - Выставить права: `chmod 644` на новые файлы, `chmod 755` на новые папки
   - Закоммитить в git с сообщением на русском
   - Выполнить `git push` (только после проверки AC)
   - Вернуть отчёт: список созданных/изменённых файлов, AC-статус
4. **При фейле** — cronjob возвращает ошибку с diagnose, задача НЕ переходит к следующей
5. **PLAN.md всегда актуален** — перед запуском cronjob я проверяю, что PLAN.md обновлён

**Цель фазы:** Спроектировать полную архитектуру extension до начала кодирования.

### Acceptance Criteria Phase 1 (DoD Phase 1)

| # | Критерий | Проверка |
|---|---------|---------|
| AC-1.1 | Определены все компоненты системы и их взаимодействие | Review диаграммы и описания |
| AC-1.2 | Описан data flow для каждого режима (chat, edit, autocomplete, apply) | Чтение документации |
| AC-1.3 | Определены интерфейсы провайдеров и типов данных | Проверка types.ts |
| AC-1.4 | Спроектирована структура файлов проекта | Список файлов в плане |
| AC-1.5 | Выбраны технологии и обоснованы tradeoffs | Секция 1.7 |
| AC-1.6 | План согласован с заказчиком (пользователем) | Утверждение в чате |

**Gate Phase 1 → Phase 2:** Все AC-1.* выполнены, план утверждён → переходим к реализации.

### 1.1 Общая архитектура

```
┌─────────────────────────────────────────────────────┐
│                    VS Code Host                      │
│  ┌───────────────────────────────────────────────┐  │
│  │              Extension (activation.ts)         │  │
│  │  ┌─────────┐ ┌──────────┐ ┌────────────────┐ │  │
│  │  │ Commands │ │  Config  │ │  Status Bar    │ │  │
│  │  └────┬────┘ └──────────┘ └────────────────┘ │  │
│  │       │                                        │  │
│  │  ┌────▼────────────────────────────────────┐   │  │
│  │  │           Mode Router                    │   │  │
│  │  │  ┌────┐ ┌────┐ ┌──────┐ ┌─────────┐    │   │  │
│  │  │  │Chat│ │Edit│ │Auto. │ │  Apply  │    │   │  │
│  │  │  └──┬─┘ └──┬─┘ └──┬───┘ └────┬────┘    │   │  │
│  │  └─────┼──────┼──────┼──────────┼─────────┘   │  │
│  │        │      │      │          │              │  │
│  │  ┌─────▼──────▼──────▼──────────▼─────────┐   │  │
│  │  │          Provider Manager               │   │  │
│  │  │  ┌──────────┐ ┌──────────────────────┐  │   │  │
│  │  │  │ Config   │ │  OpenAI-Compatible   │  │   │  │
│  │  │  │ (models) │ │  Streaming Client    │  │   │  │
│  │  │  └──────────┘ └──────────┬───────────┘  │   │  │
│  │  └──────────────────────────┼───────────────┘   │  │
│  └─────────────────────────────┼───────────────────┘  │
│                                │ HTTP/SSE             │
│                       ┌────────▼────────┐             │
│                       │  LLM Provider   │             │
│                       │ (OpenAI API /   │             │
│                       │  Local / Proxy) │             │
│                       └─────────────────┘             │
└───────────────────────────────────────────────────────┘
```

### 1.2 Компоненты системы

| Компонент | Назначение | Ключевые классы/файлы |
|-----------|-----------|----------------------|
| **Extension Core** | Lifecycle, команды, конфиг | `extension.ts`, `activation.ts`, `registerCommands.ts` |
| **Provider Manager** | OpenAI-совместимые провайдеры, стриминг | `providers/base.ts`, `providers/openai.ts`, `providers/manager.ts` |
| **Chat Mode** | WebView-панель чата, контекст кода | `modes/chat/ChatPanel.ts`, `webviews/chat/` |
| **Edit Mode** | Inline-редактирование, diff | `modes/edit/EditController.ts` |
| **Autocomplete** | Ghost text, debounce, контекст | `modes/autocomplete/GhostTextManager.ts` |
| **Apply Mode** | ReAct-агент, вызов инструментов | `modes/apply/AgentController.ts`, `ToolSystem.ts` |
| **Shared** | Стриминг, контекст, утилиты | `shared/streaming.ts`, `shared/context.ts` |

### 1.3 Data Flow — Provider System

```
User Config (settings.json)
  ↓
ProviderManager.getProvider(config)
  ↓
OpenAIProvider (базовый класс для всех OpenAI-совместимых)
  ├─ chat(messages, options) → AsyncIterable<string> (stream)
  ├─ complete(prompt) → AsyncIterable<string>
  └─ models() → string[]
        ↓
HTTP POST /v1/chat/completions (stream: true)
  ↓
SSE Parser → Chunk → Mode Renderer
```

Конфигурация провайдера в `settings.json`:

```json
{
  "llmAssistant.providers": {
    "openai": {
      "baseUrl": "https://api.openai.com/v1",
      "apiKey": "${OPENAI_API_KEY}",
      "models": ["gpt-4o", "gpt-4o-mini"]
    },
    "deepseek": {
      "baseUrl": "https://api.deepseek.com/v1",
      "apiKey": "${DEEPSEEK_API_KEY}",
      "models": ["deepseek-chat", "deepseek-coder"]
    },
    "local": {
      "baseUrl": "http://localhost:11434/v1",
      "apiKey": "ollama",
      "models": ["llama3", "codellama"]
    }
  },
  "llmAssistant.defaultProvider": "openai",
  "llmAssistant.defaultModel": "gpt-4o"
}
```

### 1.4 Режимы работы

#### Chat Mode
- WebView-панель (VS Code Side Panel)
- История сообщений (сессия)
- Вставка контекста: выделенный код, файл целиком, проблемы diagnostics
- Markdown-рендеринг + code highlighting
- Команды: `llm-assistant.chat.focus`, `llm-assistant.chat.addSelection`

#### Edit Mode
- Выделяем код → `Ctrl+I` / команда "Edit with LLM"
- Промпт: "Измени выделенный код: [инструкция пользователя]"
- Показываем diff (VS Code SCM diff или inline)
- Accept / Reject через кнопки
- Multi-line, multi-selection

#### Autocomplete
- Ghost text декорации (InlineCompletionItem)
- Триггер: пауза при печати (300-500ms debounce)
- Контекст: N строк выше курсора, синтаксис файла
- Accept: Tab, Dismiss: Escape
- Кэширование предложений (избежать повторов)
- Настройка: включить/выключить, модель для autocomplete

#### Apply Mode (Agentic)
- Задача пользователя → ReAct-агент
- **Инструменты:** readFile, writeFile, patchFile, searchFiles, readTerminal, runCommand
- Многошаговый цикл: think → act → observe → repeat
- Прогресс в WebView (лог шагов)
- Возможность отмены (CancellationToken)
- Финальный diff всех изменений

### 1.5 Детальная структура файлов проекта

Ниже — полное дерево проекта с описанием каждого файла. Всего ~40 файлов.

```
vscode-llm-assistant/                          # Корень проекта
│
├── package.json                               # Манифест extension: publisher, activationEvents,
│                                              #   contributes (commands, config, views, keybindings),
│                                              #   scripts: compile, watch, lint, test
│
├── tsconfig.json                              # strict, target ESNext, module CommonJS,
│                                              #   outDir dist, rootDir src
│
├── webpack.config.js                          # target: 'node', externals: vscode,
│                                              #   entry: ./src/extension.ts,
│                                              #   output: ./dist/extension.js
│
├── .vscodeignore                              # Исключения для vsce package
│
├── .vscode/
│   ├── launch.json                            # Конфиг запуска: Extension + Attach
│   └── settings.json                          # Рекомендации: editor.formatOnSave, files.exclude
│
├── README.md                                  # Документация: фичи, установка, конфигурация,
│                                              #   скриншоты
│
├── CHANGELOG.md                               # Версии и изменения
│
├── LICENSE                                    # MIT
│
├── media/                                     # Статические ресурсы
│   └── icons/
│       ├── icon.png                           # Иконка extension (128x128)
│       └── chat.svg                           # Иконка для панели чата
│
├── src/                                       # Исходный код
│   │
│   ├── extension.ts                           # ТОЧКА ВХОДА. activate() / deactivate().
│   │                                          #   Регистрирует все компоненты в context.subscriptions
│   │                                          #   Инициализирует: ProviderManager, ModeRouter
│   │
│   ├── activation/                            # Жизненный цикл extension
│   │   ├── activation.ts                      # Логика activate/deactivate, graceful shutdown
│   │   └── registerCommands.ts                # Регистрация всех команд (6 команд) и хоткеев
│   │
│   ├── providers/                             # 🧩 Система провайдеров (OpenAI-совместимые)
│   │   ├── types.ts                           # Интерфейсы: ProviderConfig, ChatMessage,
│   │   │                                      #   CompletionOptions, LLMProvider
│   │   ├── base.ts                            # Абстрактный BaseProvider — шаблон для всех
│   │   │                                      #   провайдеров. chat() возвращает AsyncIterable
│   │   ├── openai.ts                          # OpenAIProvider: POST /v1/chat/completions
│   │   │                                      #   stream: true, SSE парсинг, AbortSignal,
│   │   │                                      #   ретраи с exponential backoff
│   │   └── manager.ts                         # ProviderManager: читает settings.json,
│   │                                           #   getProvider(), getDefault(), refresh()
│   │
│   ├── modes/                                 # 🎯 4 режима работы (Mode Router)
│   │   │
│   │   ├── chat/                              # 💬 CHAT MODE
│   │   │   ├── ChatPanel.ts                   # WebviewPanel lifecycle: создать, показать,
│   │   │   │                                  #   скрыть, удалить. postMessage routing.
│   │   │   ├── ChatViewProvider.ts            # WebviewViewProvider для боковой панели
│   │   │   │                                  #   resolveWebviewView(), getHtmlForWebview()
│   │   │   └── ConversationManager.ts         # Хранит историю [{role, content}],
│   │   │                                      #   сохраняет в context.workspaceState (Memento)
│   │   │                                      #   прикрепляет контекст кода (file + selection)
│   │   │
│   │   ├── edit/                              # ✏️ EDIT MODE
│   │   │   ├── EditController.ts              # Хендлер Ctrl+I: выделение → QuickPick
│   │   │   │                                  #   (ввод инструкции) → LLM запрос → diff view
│   │   │   └── diff.ts                        # Утилиты diff: сравнение старого/нового кода,
│   │   │                                      #   создание декораций (зелёный/красный фон),
│   │   │                                      #   принятие/отклонение через command buttons
│   │   │
│   │   ├── autocomplete/                      # ⚡ AUTOCOMPLETE (Ghost Text)
│   │   │   ├── AutocompleteController.ts      # Подписка на onDidChangeTextDocument,
│   │   │   │                                  #   debounce 500ms, триггер запроса
│   │   │   ├── GhostTextManager.ts            # InlineCompletionItemProvider: регистрация,
│   │   │   │                                  #   provideInlineCompletionItems, accept (Tab),
│   │   │   │                                  #   dismiss (Escape), кэш предложений
│   │   │   └── ContextBuilder.ts              # Сбор контекста: текст до курсора (N строк),
│   │   │                                      #   текст после, расширение файла, AST-токены,
│   │   │                                      #   ограничение по токенам
│   │   │
│   │   └── apply/                             # 🤖 APPLY MODE (Agentic Coding)
│   │       ├── AgentController.ts             # ReAct-цикл: system prompt → LLM →
│   │       │                                  #   tool_call → execute → observe → repeat →
│   │       │                                  #   финальный ответ. CancellationToken.
│   │       │                                  #   maxIterations = 20 (configurable)
│   │       ├── ToolSystem.ts                  # Реестр инструментов: register, execute,
│   │       │                                  #   formatResult. Абстракция над файловой
│   │       │                                  #   системой VS Code workspace
│   │       └── ToolDefinitions.ts             # 5 инструментов с JSON-schema:
│   │                                           #   read_file, write_file, patch_file,
│   │                                           #   search_files, run_terminal
│   │
│   ├── shared/                                # 🔧 Shared utilities
│   │   ├── streaming.ts                       # SSE парсер: разбор data: {...}\n\n,
│   │   │                                      #   генерация AsyncIterable<string>,
│   │   │                                      #   обработка ошибок стрима
│   │   ├── context.ts                         # Извлечение контекста из редактора:
│   │   │                                      #   getActiveEditorContent(), getSelection(),
│   │   │                                      #   getDiagnostics(), tokenCount()
│   │   ├── diff.ts                            # Утилиты: compareText(old, new) →
│   │   │                                      #   Change[], applyChanges(), revertChanges()
│   │   └── types.ts                           # Общие типы: Mode, ContextFile,
│   │                                           #   StreamChunk, CommandPaletteItem
│   │
│   └── webviews/                              # 🖥 WebView UI (фронтенд)
│       └── chat/                              #   Vanilla JS — никаких фреймворков
│           ├── index.html                     #   Структура: header (контекст) + messages +
│           │                                  #     input + отправка
│           ├── styles.css                     #   Тёмная тема VS Code, code blocks,
│           │                                  #     анимация стриминга, scroll
│           └── main.js                        #   postMessage ↔ extension, markdown render,
│                                               #     highlight.js для подсветки кода
│
├── test/                                      # 🧪 Тесты
│   ├── runTest.ts                             # Запуск тестов через vscode-test
│   ├── suite/
│   │   ├── extension.test.ts                  # Smoke-тест: activation, deactivation
│   │   ├── providers.test.ts                  # ProviderManager: конфиг, выбор, ошибки
│   │   ├── streaming.test.ts                  # SSE парсинг: чанки, ошибки, abort
│   │   ├── tools.test.ts                      # ToolSystem: execute, валидация аргументов
│   │   ├── context.test.ts                    # ContextBuilder: сбор контекста
│   │   └── conversation.test.ts               # ConversationManager: save/load сессий
│   └── fixtures/                              # Тестовые данные
│       ├── sample.ts                          # Пример файла для тестов контекста
│       └── mock-responses/                    # Mock SSE ответы LLM
│           ├── chat-stream.txt
│           └── tool-calls.json
│
├── .github/
│   └── workflows/
│       ├── ci.yml                             # CI: lint → test → build (на каждый push/PR)
│       └── publish.yml                        # Публикация: vsce publish (по тэгу v*)
│
├── dist/                                      # Сборка (создаётся webpack, в .gitignore)
│   └── extension.js
│
└── .gitignore                                 # Node, dist, .vsix
```

### 1.6 Ключевые интерфейсы

```typescript
// providers/types.ts
interface ProviderConfig {
  name: string;
  baseUrl: string;
  apiKey: string;
  models: string[];
}

interface ChatMessage {
  role: 'system' | 'user' | 'assistant';
  content: string;
}

interface CompletionOptions {
  model: string;
  temperature?: number;
  maxTokens?: number;
  stream?: boolean;
}

interface LLMProvider {
  chat(messages: ChatMessage[], options: CompletionOptions): AsyncIterable<string>;
  models(): Promise<string[]>;
}

// modes/apply/ToolSystem.ts
interface Tool {
  name: string;
  description: string;
  parameters: Record<string, unknown>;
  execute(args: unknown): Promise<string>;
}

// shared/types.ts
type Mode = 'chat' | 'edit' | 'autocomplete' | 'apply';
```

### 1.7 Tradeoffs и открытые вопросы

| Вопрос | Вариант А | Вариант Б | Рекомендация |
|--------|-----------|-----------|-------------|
| UI чата | WebView (React) | WebView (Vanilla JS) | Vanilla JS — легче, без доп. зависимостей |
| Autocomplete API | InlineCompletionItem (VS Code 1.68+) | Свои декорации | InlineCompletionItem — стандартный API |
| Apply: парсинг инструментов | function calling API | Парсинг из текста (XML) | function calling — точнее, если провайдер поддерживает |
| Apply: ReAct vs Plan-and-Execute | ReAct (итеративный) | Plan → Execute | ReAct — гибче, plan-first — предсказуемее |
| Хранение сессий | VS Code Memento | SQLite/JSON файл | Memento — для лёгкого старта |

---

## ФАЗА 2: Реализация

**Цель фазы:** Полностью рабочий extension со всеми 4 режимами.

**Acceptance Criteria Phase 2 (общие для всего extension):**

| # | Критерий | Проверка |
|---|---------|---------|
| AC-2.0 | Все 4 режима работают в Extension Development Host | F5 → ручная проверка |
| AC-2.1 | Минимум 1 OpenAI-совместимый провайдер работает (streaming ответов) | Чат отправляет и получает стрим |
| AC-2.2 | Настройки провайдеров читаются из VS Code settings | Изменение settings.json → применяется |
| AC-2.3 | Все команды зарегистрированы и вызываются | Command Palette |
| AC-2.4 | Unit-тесты покрывают ключевые компоненты | `npm test` проходит |
| AC-2.5 | Extension не падает с uncaught exception | Проверка Output panel |
| AC-2.6 | Сборка `vsce package` успешна | .vsix файл создан |

---

### Задача 1: Инициализация проекта

**Objective:** Создать структуру TypeScript-проекта, настроить сборку, дебаг.

**Files:**
- Create: `package.json`
- Create: `tsconfig.json`
- Create: `webpack.config.js`
- Create: `.vscode/launch.json`
- Create: `.vscodeignore`
- Create: `src/extension.ts` (заглушка)

**Шаги:**
1. Инициализировать git:
```bash
cd /opt/data/projects/vscode-llm-assistant
git init
git remote add origin git@github.com:alekseyber/vscode-llm-assistant.git
```

2. Создать `package.json` — вручную или через `npm init`:
   - `name`: `vscode-llm-assistant`
   - `publisher`: `alekseyber`
   - `version`: `0.1.0`
   - `engines.vscode`: `^1.131.0`
   - `activationEvents`: `onStartupFinished`
   - `contributes`: commands, configuration, viewsContainers, views
   - Установка зависимостей (см. секцию Зависимости выше)

3. Настроить `tsconfig.json` (strict, ESNext, CommonJS)

4. Настроить `webpack.config.js` для VS Code extension (target: 'node', externals: vscode)

5. Создать `src/extension.ts`:
```typescript
import * as vscode from 'vscode';

export function activate(context: vscode.ExtensionContext) {
    console.log('LLM Assistant activated');
}

export function deactivate() {}
```

6. `F5` → запуск Extension Development Host

7. Установить права доступа на все созданные файлы:
```bash
chmod 644 package.json tsconfig.json webpack.config.js .vscodeignore src/extension.ts
chmod 755 .vscode src
```

8. Закоммитить и запушить:
```bash
git add .
git commit -m "Задача 1: инициализация проекта, настройка сборки и дебага"
git push origin main

| # | Критерий | Проверка |
|---|---------|---------|
| AC-1.1 | `npm run compile` без ошибок | Выполнить в терминале |
| AC-1.2 | `F5` запускает Extension Development Host | Визуально |
| AC-1.3 | В Output (log) есть "LLM Assistant activated" | Проверить Output panel |
| AC-1.4 | `package.json` содержит все contributes | Проверить файл |
| AC-1.5 | Права доступа: `644` на файлы, `755` на папки | `ls -la` |
| AC-1.6 | Код закоммичен с сообщением на русском | `git log` |

**Gate → Задача 2:** Все AC-1.* = PASS. Если нет — фикс до перехода.

---

### Задача 2: Provider Manager — базовый провайдер

**Objective:** Реализовать BaseProvider + OpenAIProvider со стримингом.

**Files:**
- Create: `src/providers/types.ts`
- Create: `src/providers/base.ts`
- Create: `src/providers/openai.ts`
- Create: `src/providers/manager.ts`

**Ключевые моменты:**
- BaseProvider — абстрактный класс с `chat()`, `models()`
- OpenAIProvider:
  - POST `/v1/chat/completions` с `stream: true`
  - Парсинг SSE (data: {...} \n\n)
  - Возврат `AsyncIterable<string>` (генератор)
  - Поддержка `AbortSignal` для отмены
- ProviderManager:
  - Читает `vscode.workspace.getConfiguration('llmAssistant.providers')`
  - Хранит Map<name, LLMProvider>
  - Методы: `getProvider(name)`, `getDefault()`, `refresh()`

**Acceptance Criteria (DoD) Задача 2:**

| # | Критерий | Проверка |
|---|---------|---------|
| AC-2.1 | `BaseProvider` — абстрактный класс с методом `chat()` | tsc проверка типа |
| AC-2.2 | `OpenAIProvider.chat()` возвращает `AsyncIterable<string>` с реальными токенами | Интеграционный тест с реальным API (или mock) |
| AC-2.3 | `OpenAIProvider` стримит токены по SSE | Проверка: получаем >1 чанк |
| AC-2.4 | `AbortSignal` прерывает запрос | Тест: abort → нет новых чанков |
| AC-2.5 | `ProviderManager` читает конфиг из `vscode.workspace.getConfiguration` | Unit test |
| AC-2.6 | `ProviderManager.getDefault()` возвращает провайдер по умолчанию | Unit test |
| AC-2.7 | Все тесты проходят | `npm test` |

**Gate → Задача 3:** Все AC-2.* = PASS. Если нет — фикс.

---

### Задача 3: Chat Mode — WebView панель

**Objective:** Создать боковую панель чата с отправкой сообщений и стримингом ответа.

**Files:**
- Create: `src/modes/chat/ChatPanel.ts`
- Create: `src/modes/chat/ChatViewProvider.ts`
- Create: `src/modes/chat/ConversationManager.ts`
- Create: `src/webviews/chat/index.html`
- Create: `src/webviews/chat/styles.css`
- Create: `src/webviews/chat/main.js`

**Шаги:**
1. Зарегистрировать `WebviewViewProvider` через `vscode.window.registerWebviewViewProvider`
2. WebView HTML с:
   - Поле ввода + кнопка отправки
   - Контейнер сообщений
   - Markdown-рендеринг (highlight.js или простой)
3. postMessage API:
   - WebView → Extension: `{type: 'sendMessage', text: '...', context: {...}}`
   - Extension → WebView: `{type: 'streamChunk', text: 'token'}` и `{type: 'done'}`
4. ConversationManager:
   - Хранит историю сообщений
   - Сохраняет/восстанавливает через `context.workspaceState`
   - Прикрепляет контекст кода (выделение, текущий файл)

**Команды:**
- `llmAssistant.chat.focus` — открыть/сфокусировать панель
- `llmAssistant.chat.addSelection` — добавить выделенный код в контекст

**Acceptance Criteria (DoD) Задача 3:**

| # | Критерий | Проверка |
|---|---------|---------|
| AC-3.1 | WebView-панель отображается в Side Bar | F5 → View → LLM Assistant |
| AC-3.2 | Отправка сообщения → стриминг ответа в WebView | Текст появляется по токенам |
| AC-3.3 | История сообщений сохраняется между сессиями | Закрыть/открыть VS Code → история есть |
| AC-3.4 | Команда `llmAssistant.chat.focus` открывает панель | Command Palette |
| AC-3.5 | Команда `llmAssistant.chat.addSelection` добавляет код в контекст | Выделить код → команда → видно в чате |
| AC-3.6 | Markdown-рендеринг работает (код блоки, ссылки) | Отправить запрос с кодом в ответе |
| AC-3.7 | Нет regression в Задача 1-2 (провайдеры работают) | `npm test` |

**Gate → Задача 4:** Все AC-3.* = PASS. Если нет — фикс.

---

### Задача 4: Edit Mode — inline-редактирование

**Objective:** Выделить код → промпт → diff → accept/reject.

**Files:**
- Create: `src/modes/edit/EditController.ts`
- Create: `src/modes/edit/diff.ts`

**Логика:**
1. Пользователь выделяет код → `Ctrl+I` / команда
2. QuickPick: ввод инструкции ("добавить типы", "переписать на async/await")
3. Отправка в LLM: контекст (выделенный код + инструкция)
4. Получение результата (предполагаем, что LLM вернёт полный исправленный блок)
5. Показываем diff:
   - Через `vscode.TextEditor.edit()` + декорации (зелёный/красный фон)
   - Или создаём временный документ с diff
6. Кнопки Accept (применить) / Reject (отменить)
7. `textEdit` в `InlineCompletionItem` для бесшовного apply

**Acceptance Criteria (DoD) Задача 4:**

| # | Критерий | Проверка |
|---|---------|---------|
| AC-4.1 | Выделить код → `Ctrl+I` → появляется поле ввода инструкции | Ручная проверка |
| AC-4.2 | После ввода инструкции → LLM возвращает изменённый код | Ручная проверка |
| AC-4.3 | Diff отображается (изменения подсвечены) | Визуально |
| AC-4.4 | Accept применяет изменения в редактор | Кнопка Accept → код изменён |
| AC-4.5 | Reject отменяет изменения | Кнопка Reject → код без изменений |
| AC-4.6 | Работает с многострочным выделением | Выделить 10+ строк |
| AC-4.7 | Нет regression в Задача 1-3 | `npm test`, чат работает |

**Gate → Задача 5:** Все AC-4.* = PASS. Если нет — фикс.

---

### Задача 5: Autocomplete — Ghost Text

**Objective:** Ghost text при паузе в печати.

**Files:**
- Create: `src/modes/autocomplete/AutocompleteController.ts`
- Create: `src/modes/autocomplete/GhostTextManager.ts`
- Create: `src/modes/autocomplete/ContextBuilder.ts`

**Логика:**
1. Подписка на `vscode.workspace.onDidChangeTextDocument`
2. Debounce 500ms после последнего изменения
3. ContextBuilder собирает:
   - Текст до курсора (~200 строк, ограничено токенами)
   - Текст после курсора (~50 строк)
   - Путь файла, язык
4. Запрос в LLM: "Continue the code at cursor: {prefix}<FILL_HERE>{suffix}"
   (или chat completion с инструкцией продолжения кода)
5. GhostTextManager:
   - Создаёт `vscode.InlineCompletionItem` с `insertText` и `range`
   - Регистрирует `vscode.languages.registerInlineCompletionItemProvider`
6. Accept: Tab | Dismiss: Escape
7. Кэш: не предлагать то же самое 2 раза подряд

**Acceptance Criteria (DoD) Задача 5:**

| # | Критерий | Проверка |
|---|---------|---------|
| AC-5.1 | При печати и паузе ~500ms появляется ghost text | Ручная проверка |
| AC-5.2 | `Tab` принимает предложение | Код вставляется |
| AC-5.3 | `Escape` скрывает предложение | Ghost text исчезает |
| AC-5.4 | Предложение соответствует контексту (язык, соседний код) | Визуально |
| AC-5.5 | Autocomplete можно отключить через настройку `llmAssistant.autocomplete.enabled` | Изменить → перестал показывать |
| AC-5.6 | Кэш не дублирует одинаковые предложения | 2 раза подряд одинаковый ввод → второй раз не показано |
| AC-5.7 | Нет regression в Задача 1-4 | `npm test`, чат, edit работают |

**Gate → Задача 6:** Все AC-5.* = PASS. Если нет — фикс.

---

### Задача 6: Apply Mode — Agentic Coding

**Objective:** Агент, который может читать/писать/патчить файлы по задаче пользователя.

**Files:**
- Create: `src/modes/apply/AgentController.ts`
- Create: `src/modes/apply/ToolSystem.ts`
- Create: `src/modes/apply/ToolDefinitions.ts`

**Tool Definitions:**
```typescript
const tools: Tool[] = [
  {
    name: 'read_file',
    description: 'Read contents of a file',
    parameters: { path: 'string', offset?: 'number', limit?: 'number' },
    execute: async ({path, offset, limit}) => { /* read file */ }
  },
  {
    name: 'write_file',
    description: 'Write content to a file (overwrites)',
    parameters: { path: 'string', content: 'string' },
    execute: async ({path, content}) => { /* write file */ }
  },
  {
    name: 'patch_file',
    description: 'Find and replace text in a file',
    parameters: { path: 'string', old: 'string', new: 'string' },
    execute: async ({path, old, new}) => { /* patch */ }
  },
  {
    name: 'search_files',
    description: 'Search for files or text in files',
    parameters: { pattern: 'string', path?: 'string' },
    execute: async ({pattern, path}) => { /* search */ }
  },
  {
    name: 'run_terminal',
    description: 'Run a shell command',
    parameters: { command: 'string', workdir?: 'string', timeout?: 'number' },
    execute: async ({command, workdir, timeout}) => { /* exec */ }
  },
];
```

**ReAct-цикл в AgentController:**
1. Получаем задачу пользователя
2. System prompt: "You are a coding agent. You have tools..."
3. Цикл:
   a. LLM → response (содержит tool_call или финальный ответ)
   b. Если tool_call → выполняем инструмент → результат в сообщения
   c. Если финальный ответ → показываем сводку изменений
4. CancellationToken для отмены
5. WebView для лога шагов (what is agent doing now)

**Acceptance Criteria (DoD) Задача 6:**

| # | Критерий | Проверка |
|---|---------|---------|
| AC-6.1 | Apply-режим запускается по команде `llmAssistant.apply.start` | Ручная проверка |
| AC-6.2 | Агент может прочитать файл (read_file) | Тест: запрос "прочитай файл X" |
| AC-6.3 | Агент может записать файл (write_file) | Тест: запрос "создай файл Y с содержимым Z" |
| AC-6.4 | Агент может патчить файл (patch_file) | Тест: запрос "замени строку A на B в файле" |
| AC-6.5 | Агент может искать в файлах (search_files) | Тест: запрос "найди все упоминания X" |
| AC-6.6 | Агент может выполнить команду терминала (run_terminal) | Тест: запрос "запусти ls" |
| AC-6.7 | ReAct-цикл завершается (не бесконечный) | maxIterations=20, тест с простой задачей |
| AC-6.8 | CancelToken прерывает агента | Кнопка отмены → агент останавливается |
| AC-6.9 | Лог шагов отображается в WebView | Видно "read_file → ...", "write_file → ..." |
| AC-6.10 | Финальный diff изменений показывается | После завершения → diff |
| AC-6.11 | Нет regression в Задача 1-5 | `npm test`, чат, edit, autocomplete работают |

**Gate → Задача 7:** Все AC-6.* = PASS. Если нет — фикс.

---

### Задача 7: Интеграция и команды

**Objective:** Связать все режимы через единый Command Palette и горячие клавиши.

**Files:**
- Modify: `src/extension.ts`
- Modify: `src/activation/registerCommands.ts`

**Команды:**

| Команда | Хоткей | Действие |
|---------|--------|----------|
| `llmAssistant.chat.focus` | `Ctrl+Shift+L` | Открыть чат |
| `llmAssistant.chat.addSelection` | — | Добавить выделение в контекст чата |
| `llmAssistant.edit.selection` | `Ctrl+I` | Редактировать выделенный код |
| `llmAssistant.autocomplete.toggle` | — | Вкл/Выкл автокомплит |
| `llmAssistant.apply.start` | `Ctrl+Shift+A` | Запустить агентный режим |
| `llmAssistant.selectProvider` | — | Выбрать провайдер/модель |

**Acceptance Criteria (DoD) Задача 7:**

| # | Критерий | Проверка |
|---|---------|---------|
| AC-7.1 | Все 6 команд зарегистрированы и видны в Command Palette | `Ctrl+Shift+P` → поиск команд |
| AC-7.2 | `Ctrl+Shift+L` открывает чат | Хоткей |
| AC-7.3 | `Ctrl+I` запускает edit режим | Хоткей |
| AC-7.4 | `Ctrl+Shift+A` запускает apply режим | Хоткей |
| AC-7.5 | `llmAssistant.selectProvider` показывает список провайдеров/моделей | QuickPick |
| AC-7.6 | Смена провайдера через selectProvider применяется | Выбрать → следующие запросы идут через новый провайдер |
| AC-7.7 | Нет regression в Задача 1-6 | `npm test`, все режимы работают |

**Gate → Задача 8:** Все AC-7.* = PASS. Если нет — фикс.

---

### Задача 8: Конфигурация и настройки

**Objective:** Все настройки провайдеров и поведения через VS Code settings.

**Files:**
- Modify: `package.json` (contributes.configuration)

**Настройки:**
```json
{
  "llmAssistant.providers": { /* см. выше */ },
  "llmAssistant.defaultProvider": "openai",
  "llmAssistant.defaultModel": "gpt-4o",
  "llmAssistant.autocomplete.enabled": true,
  "llmAssistant.autocomplete.debounceMs": 500,
  "llmAssistant.chat.maxContextTokens": 4096,
  "llmAssistant.apply.maxIterations": 20,
  "llmAssistant.agent.model": "gpt-4o"
}
```

**Acceptance Criteria (DoD) Задача 8:**

| # | Критерий | Проверка |
|---|---------|---------|
| AC-8.1 | Все настройки отображаются в Settings UI | `Ctrl+,` → поиск "llmAssistant" |
| AC-8.2 | Изменение `defaultProvider` применяется | Сменить → новый провайдер по умолчанию |
| AC-8.3 | Изменение `autocomplete.enabled` применяется | false → autocomplete не срабатывает |
| AC-8.4 | Настройки имеют description и default values | Проверить package.json |
| AC-8.5 | Нет regression в Задача 1-7 | `npm test`, все режимы работают |

**Gate → Задача 9:** Все AC-8.* = PASS. Если нет — фикс.

---

### Задача 9: Тестирование

**Objective:** Unit-тесты для ключевых компонентов.

**Files:**
- Create: `test/suite/providers.test.ts`
- Create: `test/suite/streaming.test.ts`
- Create: `test/suite/tools.test.ts`

**Что тестировать:**
- ProviderManager — парсинг конфига, выбор провайдера
- Streaming — парсинг SSE чанков
- ToolSystem — вызов инструментов, обработка ошибок
- ContextBuilder — сбор контекста из редактора
- ConversationManager — сохранение/восстановление истории

**Acceptance Criteria (DoD) Задача 9:**

| # | Критерий | Проверка |
|---|---------|---------|
| AC-9.1 | `npm test` проходит все тесты | Выполнить |
| AC-9.2 | Coverage >= 60% для shared/ и providers/ | `nyc` report |
| AC-9.3 | Streaming тест проверяет парсинг SSE data: чанков | Mock response |
| AC-9.4 | ProviderManager тест проверяет чтение конфига | Mock workspace config |
| AC-9.5 | ToolSystem тест проверяет execute и ошибки | Mock файловой системы |
| AC-9.6 | Нет regression в Задача 1-8 | Все режимы работают после тестов |

**Gate → Задача 10:** Все AC-9.* = PASS. Если нет — фикс.

---

### Задача 10: Публикация и CI

**Objective:** GitHub Actions, публикация в VS Code Marketplace.

**Files:**
- Create: `.github/workflows/ci.yml`
- Create: `.github/workflows/publish.yml`

**Шаги:**
1. `vsce package` — сборка .vsix
2. GitHub Actions: lint → test → build
3. Публикация через `vsce publish` (триггер по тэгу)

**Acceptance Criteria (DoD) Задача 10:**

| # | Критерий | Проверка |
|---|---------|---------|
| AC-10.1 | `vsce package` создаёт .vsix файл без ошибок | Выполнить |
| AC-10.2 | CI workflow проходит (lint → test → build) | GitHub Actions статус |
| AC-10.3 | Публикация по тэгу v* срабатывает | Push tag → publish в Marketplace |
| AC-10.4 | README.md с описанием, скриншотами, инструкцией | Файл существует |
| AC-10.5 | CHANGELOG.md с версиями | Файл существует |
| AC-10.6 | Нет regression в Задача 1-9 | `npm test` |

**Gate → Phase 2 Complete:** Все AC-2.* + AC-10.* = PASS.

---

## Итоговая roadmap с gates

```
┌───────────┬──────────────────────────────────┬──────────────────────┬──────────────────────┐
│  Спринт   │              Что делаем           │    DoD проверка      │    Gate к следующему │
├───────────┼──────────────────────────────────┼──────────────────────┼──────────────────────┤
│  0        │ Фаза 1: Архитектура              │ AC-1.1 → AC-1.6      │ Утверждение плана    │
│  1 (день) │ Задача 1: Проект                 │ AC-1.1 → AC-1.6      │ F5 → extension alive │
│           │ Задача 2: Provider Manager       │ AC-2.1 → AC-2.7      │ npm test PASS        │
│  2 (день) │ Задача 3: Chat Mode              │ AC-3.1 → AC-3.7      │ Чат стримит ответы   │
│  3 (день) │ Задача 4: Edit Mode              │ AC-4.1 → AC-4.7      │ Accept/Reject работают│
│  4 (день) │ Задача 5: Autocomplete           │ AC-5.1 → AC-5.7      │ Ghost text по Tab    │
│  5-6 (дни)│ Задача 6: Apply Mode (агент)     │ AC-6.1 → AC-6.11     │ ReAct + инструменты  │
│  7 (день) │ Задача 7: Интеграция             │ AC-7.1 → AC-7.7      │ Все хоткеи работают  │
│           │ Задача 8: Конфигурация           │ AC-8.1 → AC-8.5      │ Settings UI          │
│  8 (день) │ Задача 9: Тестирование           │ AC-9.1 → AC-9.6      │ Coverage >= 60%      │
│           │ Задача 10: CI + Публикация       │ AC-10.1 → AC-10.6    │ .vsix собран         │
└───────────┴──────────────────────────────────┴──────────────────────┴──────────────────────┘
```

**Правило:** Если на любом gate AC не выполнены → **стоп**. Фикс → retest → только тогда переход.

---

## Как начать

```bash
# 1. Создать проект
mkdir vscode-llm-assistant && cd vscode-llm-assistant
npm init -y
npm install --save-dev @types/vscode typescript webpack ts-loader

# 2. Создать минимальную структуру
# (см. Задача 1 — следовать шагам)

# 3. Запустить дебаг
code .  # Открыть в VS Code
F5      # Extension Development Host
```