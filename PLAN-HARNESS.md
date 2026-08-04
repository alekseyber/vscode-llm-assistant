# VS Code LLM Assistant — Harness: 7 слоёв агента

> **Фаза:** Harness — достройка инфраструктуры для превращения LLM в надёжного исполнителя
> **База:** слайд «Из чего состоит хороший harness» (7 слоёв) + существующая архитектура плагина
> **Цель:** Плагин становится Product Shell (слой 07), через который агент управляет полным циклом разработки
> **Релиз:** после выполнения ВСЕХ задач и отдельной команды пользователя. Коммиты — без публикации.

**Текущая версия:** 0.5.3 → целевая 0.6.0

---

## Общие требования

### Права доступа
- Файлы: `chmod 644`, папки: `chmod 755`

### Язык
- Комментарии и документация — русский
- Имена переменных/классов — английский
- Commit messages — русский

### Git
- Каждая задача = отдельный коммит
- Push только после проверки AC
- Без force-push
- Тег `v0.6.0` — только после финальной команды пользователя

### Исполнение
- Каждая задача = однократный cronjob
- Cronjob читает PLAN-HARNESS.md как source of truth
- Чистый контекст, самодостаточный prompt
- В конце: проверка AC → chmod → commit → push → отчёт о затратах

---

## Маппинг: 7 слоёв → Задачи

| Слой | Название | Задача | Приоритет |
|------|----------|--------|-----------|
| 01 | System policy | Задача 1: AGENTS.md автоинжект | 🔥 |
| 04 | Context management | Задача 2: Summary при переполнении | 🔥 |
| 06 | Reliability & safety | Задача 3: Ретраи + таймауты | 🟡 |
| 02 | Tool contracts | Задача 4: Allow-list инструментов | 🟡 |
| 05 | Common interfaces | Задача 5: MCP-клиент (базовый) | 🟢 |
| 07 | Product shell | Задача 6: Run History Dashboard | 🟢 |

---

## Задача 1: AGENTS.md автоинжект (System Policy)

**Слой 01:** System policy — роль, правила поведения, формат ответа, критерии остановки.

### Описание

Агент при старте (и AgentController, и ChatAgentTools) читает файл `AGENTS.md` из корня workspace и добавляет его содержимое в system prompt. Если файла нет — используется стандартный промпт без изменений.

AGENTS.md — это стандарт де-факто (используется в Claude Code, Cursor, OpenCode), файл в корне проекта с правилами для AI-агента.

### Что сделать

1. Создать модуль `src/shared/AgentsMdLoader.ts`:
   - `loadAgentsMd(): Promise<string | null>` — читает AGENTS.md из корня workspace
   - Кеширует содержимое (следит за `onDidChangeTextDocument` для инвалидации)
   - Возвращает `null` если файла нет

2. Интегрировать в `AgentController.run()`:
   - После формирования `systemPrompt` добавить содержимое AGENTS.md с заголовком `\n\n## Правила проекта (AGENTS.md):\n{content}`
   - Если AGENTS.md нет — поведение не меняется

3. Интегрировать в `ChatViewProvider` (чат + агент чата):
   - В `getMessagesForRequest()` добавлять AGENTS.md в system message
   - Аналогично — если файла нет, промпт не меняется

4. Добавить настройку `llmAssistant.agentsMd.enabled` (boolean, default true)

### Acceptance Criteria

| # | Критерий | Проверка |
|---|----------|----------|
| AC-1.1 | `AgentsMdLoader.loadAgentsMd()` возвращает содержимое AGENTS.md из корня workspace | Юнит-тест с временным файлом |
| AC-1.2 | Если AGENTS.md отсутствует — возвращает `null`, агент работает без ошибок | Юнит-тест |
| AC-1.3 | System prompt агента содержит правила из AGENTS.md после `## Правила проекта` | Интеграционный тест: мок-файл → проверка system prompt |
| AC-1.4 | System prompt чата содержит правила из AGENTS.md | Интеграционный тест |
| AC-1.5 | Настройка `llmAssistant.agentsMd.enabled: false` отключает инжект | Проверка конфига |
| AC-1.6 | AGENTS.md кешируется и инвалидируется при изменении файла | Тест: изменили файл → следующий запрос с новым содержимым |
| AC-1.7 | `npm run compile` без ошибок | CI |
| AC-1.8 | Существующие тесты не сломаны | `npm test` |

---

## Задача 2: Summary при переполнении контекста (Context Management)

**Слой 04:** Context management — обрезка истории, summary, память через файлы, subagents.

### Описание

Когда история сообщений превышает `maxContextTokens` (из настроек), текущая логика просто обрезает старые сообщения. Вместо этого: обрезанные сообщения сжимаются в summary и вставляются как второе system-сообщение.

### Что сделать

1. Создать модуль `src/shared/ContextSummarizer.ts`:
   - `summarizeMessages(messages: ChatMessage[], provider: LLMProvider, model: string): Promise<string>` 
   - Отправляет обрезанные сообщения в LLM с промптом «Сожми эту историю в краткое summary на русском»
   - Кеширует результат (повторно не пересчитывает пока не добавились новые сообщения)

2. Доработать `ConversationManager.getMessagesForRequest()`:
   - Если есть обрезанные сообщения → вызвать `ContextSummarizer.summarizeMessages()`
   - Вставить summary как system-сообщение: `{ role: 'system', content: '## Краткое содержание предыдущего диалога:\n{summary}' }`
   - Учесть токены summary в `usedTokens`

3. Добавить настройки:
   - `llmAssistant.chat.summaryEnabled` (boolean, default true)
   - `llmAssistant.chat.summaryModel` (string, default — текущая модель)
   - `llmAssistant.chat.summaryTriggerTokens` (number, default 2048 — при скольких токенах обрезанных сообщений запускать summarization)

4. Интегрировать в AgentController для длинных ReAct-сессий:
   - Если шагов > 10 и история большая — сжать первые N шагов в summary

### Acceptance Criteria

| # | Критерий | Проверка |
|---|----------|----------|
| AC-2.1 | `ContextSummarizer.summarizeMessages()` возвращает текст на русском | Юнит-тест с мок-провайдером |
| AC-2.2 | Summary вставляется как system-сообщение в историю | Интеграционный тест |
| AC-2.3 | При отключении (`summaryEnabled: false`) — старое поведение (просто обрезка) | Проверка конфига |
| AC-2.4 | Кеш: повторный вызов с теми же сообщениями не шлёт запрос в LLM | Юнит-тест |
| AC-2.5 | Кеш инвалидируется при добавлении новых сообщений | Юнит-тест |
| AC-2.6 | Summary не создаётся если обрезано < `summaryTriggerTokens` токенов | Юнит-тест |
| AC-2.7 | `npm run compile` без ошибок | CI |
| AC-2.8 | Существующие тесты не сломаны | `npm test` |

---

## Задача 3: Ретраи + таймауты (Reliability & Safety)

**Слой 06:** Reliability & safety — ошибки, ретраи, таймауты, бюджеты, sandbox, approvals.

### Описание

API-вызовы к LLM иногда падают (429, 500, 503, network timeout). Нужна обёртка с exponential backoff.

### Что сделать

1. Создать модуль `src/shared/RetryHandler.ts`:
   - `withRetry<T>(fn: () => Promise<T>, options?: RetryOptions): Promise<T>`
   - Exponential backoff: 1s, 2s, 4s, 8s (макс 3 ретрая)
   - Jitter: ±25% случайный разброс
   - Настройки: `maxRetries`, `baseDelayMs`, `maxDelayMs`, `retryOn: number[]` (коды HTTP)

2. Обернуть API-вызовы в `OpenAIProvider.chat()` и `chatWithVision()`:
   - Поймать `429`, `500`, `502`, `503`, `504`, network errors
   - Логировать каждую попытку через `logger`
   - Не ретраить на 400, 401, 403, 404

3. Добавить таймаут на каждый запрос (60s по умолчанию) через `AbortSignal.timeout()`

4. Добавить настройки:
   - `llmAssistant.retry.enabled` (boolean, default true)
   - `llmAssistant.retry.maxRetries` (number, default 3)
   - `llmAssistant.retry.requestTimeout` (number, default 60)

5. Добавить индикацию в WebView: «Повторная попытка 2/3...»

### Acceptance Criteria

| # | Критерий | Проверка |
|---|----------|----------|
| AC-3.1 | 429 ошибка → ретрай через 1s, 2s, 4s | Юнит-тест с мок-сервером |
| AC-3.2 | 500/502/503 → ретрай | Юнит-тест |
| AC-3.3 | 400/401/403 → НЕ ретрай, сразу ошибка | Юнит-тест |
| AC-3.4 | Таймаут 60s → ретрай | Юнит-тест |
| AC-3.5 | Max 3 ретрая → после 3-й ошибки исключение | Юнит-тест |
| AC-3.6 | Jitter в задержке (±25%) | Юнит-тест |
| AC-3.7 | Отключение ретраев через настройку | Проверка конфига |
| AC-3.8 | WebView: индикация ретрая | Ручной тест |
| AC-3.9 | `npm run compile` без ошибок | CI |
| AC-3.10 | Существующие тесты не сломаны | `npm test` |

---

## Задача 4: Allow-list инструментов (Tool Contracts)

**Слой 02:** Tool contracts — JSON-схемы, allow-list, валидация аргументов и результатов.

### Описание

Сейчас агент имеет доступ ко всем 6 инструментам. Добавить конфигурируемый allow-list: какие инструменты доступны в workspace.

### Что сделать

1. Создать модуль `src/modes/apply/ToolAllowList.ts`:
   - `getAllowedTools(allTools: ChatTool[], config: ToolAllowListConfig): ChatTool[]`
   - Фильтрует инструменты по списку разрешённых

2. Добавить настройки:
   - `llmAssistant.apply.allowedTools` (string[], default — все инструменты)
   - Возможные значения: `read_file`, `write_file`, `replace_in_file`, `list_files`, `search_files`, `run_terminal`
   - `llmAssistant.apply.requireConfirmation` (string[], default `["write_file", "replace_in_file", "run_terminal"]`)

3. Интегрировать в ChatAgentTools и AgentController:
   - При получении списка инструментов — фильтровать через allow-list
   - `run_terminal` исключён из allow-list по умолчанию в настройках безопасности проекта

4. Добавить конфиг `.vscode/llm-assistant.json` в workspace (опционально):
   ```json
   {
     "allowedTools": ["read_file", "search_files", "list_files"],
     "requireConfirmation": ["run_terminal"]
   }
   ```
   Этот файл имеет приоритет над глобальными настройками.

### Acceptance Criteria

| # | Критерий | Проверка |
|---|----------|----------|
| AC-4.1 | `allowedTools: ["read_file"]` → агент видит только read_file | Юнит-тест |
| AC-4.2 | `allowedTools` не указан → все инструменты доступны | Юнит-тест (обратная совместимость) |
| AC-4.3 | `.vscode/llm-assistant.json` переопределяет глобальные настройки | Интеграционный тест |
| AC-4.4 | Инструменты не из списка требуют подтверждения | Интеграционный тест |
| AC-4.5 | `npm run compile` без ошибок | CI |
| AC-4.6 | Существующие тесты не сломаны | `npm test` |

---

## Задача 5: MCP-клиент (базовый)

**Слой 05:** Common interfaces — AGENTS.md, CLAUDE.md, skills и MCP как стандартные каналы.

### Описание

MCP (Model Context Protocol) — стандартный протокол для подключения LLM к внешним инструментам. Реализовать базовый MCP-клиент в плагине: подключение к MCP-серверам и использование их инструментов наравне с встроенными.

### Что сделать

1. Установить `@modelcontextprotocol/sdk` (npm)

2. Создать модуль `src/modes/apply/McpClient.ts`:
   - `connect(config: McpServerConfig): Promise<void>` — подключение к MCP-серверу (stdio/http)
   - `listTools(): Promise<ChatTool[]>` — получить инструменты сервера
   - `executeTool(name: string, args: Record<string, unknown>): Promise<string>`
   - `disconnect(): void`

3. Интегрировать в ToolSystem:
   - При старте агента — подключиться к сконфигурированным MCP-серверам
   - Зарегистрировать их инструменты в ToolSystem
   - В allow-list включить фильтрацию и для MCP-инструментов

4. Добавить настройки:
   - `llmAssistant.mcp.servers` — массив конфигов:
     ```json
     [{
       "name": "github",
       "command": "npx",
       "args": ["-y", "@modelcontextprotocol/server-github"],
       "env": { "GITHUB_TOKEN": "${GITHUB_TOKEN}" }
     }]
     ```

### Acceptance Criteria

| # | Критерий | Проверка |
|---|----------|----------|
| AC-5.1 | MCP-клиент подключается к stdio-серверу | Юнит-тест с мок-сервером |
| AC-5.2 | Инструменты MCP-сервера видны агенту | Интеграционный тест |
| AC-5.3 | Выполнение MCP-инструмента возвращает результат | Интеграционный тест |
| AC-5.4 | Ошибка подключения не ломает агента (graceful degradation) | Юнит-тест |
| AC-5.5 | Allow-list работает для MCP-инструментов | Юнит-тест |
| AC-5.6 | `npm run compile` без ошибок | CI |
| AC-5.7 | Существующие тесты не сломаны | `npm test` |

---

## Задача 6: Run History Dashboard (Product Shell)

**Слой 07:** Product shell — CLI, UI, API, auth, история запусков, logs, observability.

### Описание

Добавить в WebView вкладку «История» с логами запусков агента: дата, задача, количество шагов, результат, ошибки.

### Что сделать

1. Создать модуль `src/shared/RunHistoryStore.ts`:
   - `recordRun(entry: RunEntry): void` — записать запуск
   - `getRuns(limit?: number): RunEntry[]` — получить историю
   - Хранение: `ExtensionContext.globalState` (persistent)
   - Max 100 записей, FIFO

2. Тип `RunEntry`:
   ```typescript
   interface RunEntry {
     id: string;
     timestamp: number;
     mode: 'chat' | 'agent' | 'edit';
     task: string;          // первые 100 символов запроса
     provider: string;
     model: string;
     steps: number;         // для агента — количество итераций
     tokensIn: number;
     tokensOut: number;
     cost: number;
     duration: number;      // мс
     status: 'success' | 'error' | 'cancelled' | 'limit_exceeded';
     error?: string;
   }
   ```

3. Интегрировать запись в `AgentController.run()` и `ChatViewProvider.handleSendMessage()`

4. WebView: добавить вкладку «История» (рядом с чатом):
   - Таблица: дата, режим, задача, шаги, токены, статус
   - Фильтр по режиму
   - Очистка истории
   - Клик по записи → детали (все шаги агента)

5. Добавить иконку в Activity Bar для быстрого доступа к истории

### Acceptance Criteria

| # | Критерий | Проверка |
|---|----------|----------|
| AC-6.1 | Запуск агента сохраняется в историю | Интеграционный тест |
| AC-6.2 | Запуск чата сохраняется в историю | Интеграционный тест |
| AC-6.3 | WebView: вкладка «История» с таблицей | Ручной тест |
| AC-6.4 | Фильтр по режиму (чат/агент/edit) | Ручной тест |
| AC-6.5 | Очистка истории | Ручной тест |
| AC-6.6 | Max 100 записей, старые вытесняются | Юнит-тест |
| AC-6.7 | История не теряется при перезагрузке VS Code | Ручной тест |
| AC-6.8 | `npm run compile` без ошибок | CI |
| AC-6.9 | Существующие тесты не сломаны | `npm test` |

---

## Gates (контрольные точки)

| Gate | После задачи | Критерий |
|------|-------------|----------|
| Gate 1 | Задача 1 | AGENTS.md инжектится в system prompt. Пользователь тестирует: создал AGENTS.md → агент следует правилам |
| Gate 2 | Задача 2 | Long-running диалог сжимается в summary. Пользователь тестирует: 50+ сообщений → есть summary |
| Gate 3 | Задача 3 | API-ошибки ретраятся. Индикация в WebView |
| Gate 4 | Задача 4 | Allow-list фильтрует инструменты. `.vscode/llm-assistant.json` работает |
| Gate 5 | Задача 5 | MCP-сервер подключен, инструменты видны агенту |
| Gate 6 | Задача 6 | История запусков видна в WebView. Данные персистентны |

**Правило:** каждая задача прерывается на Gate. Пользователь подтверждает → переход к следующей.

---

## Итоговая версия

После выполнения всех 6 задач:
- `package.json`: version `0.6.0`
- `git tag v0.6.0` (только по команде пользователя)
- Релиз через GitHub Actions с полным чек-листом

---

## Затраты (оценка)

| Задача | Токены (≈) | Провайдер | Сложность |
|--------|-----------|-----------|-----------|
| 1. AGENTS.md | 2K in / 3K out | deepseek-v4-pro | Низкая |
| 2. Summary | 3K in / 5K out | deepseek-v4-pro | Средняя |
| 3. Retry | 1K in / 2K out | deepseek-v4-pro | Низкая |
| 4. Allow-list | 2K in / 3K out | deepseek-v4-pro | Низкая |
| 5. MCP | 5K in / 8K out | deepseek-v4-pro | Высокая |
| 6. Dashboard | 4K in / 6K out | deepseek-v4-pro | Средняя |
| **Итого** | ~17K in / ~27K out | | ~$0.003 |
