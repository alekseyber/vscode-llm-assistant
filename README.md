# VS Code LLM Assistant

**AI-ассистент для VS Code** — 4 режима работы с LLM через любые OpenAI-совместимые API.

| Режим | Клавиши | Назначение |
|-------|---------|-----------|
| 💬 **Chat** | Боковая панель | Чат с контекстом кода, стриминг, индикатор токенов |
| ✏️ **Edit** | `Ctrl+I` | Выделил код → инструкция → diff → Accept/Reject |
| ⚡ **Autocomplete** | Tab/Escape | Ghost text на паузе печати |
| 🤖 **Agent** | Вкладка в чате | ReAct-агент с инструментами, делегированием, MCP, оркестрацией |

## Возможности

### 🤖 Агентный кодинг
- **ReAct-агент** с инструментами: `read_file`, `write_file`, `replace_in_file`, `list_files`, `search_files`, `run_terminal`, `web_fetch`, `ask_user`, `delegate_to_agent`
- **Подтверждение операций** перед записью/изменением файлов (с git-diff `+N −M`)
- **Allow-list инструментов** через настройки или `.vscode/llm-assistant.json`
- **Ход выполнения**: структурированные сворачиваемые шаги по тулам

### 📋 Plan Mode
- Переключатель «📋 Plan» в Agent-режиме — план перед кодом
- **Три этапа:** планирование → имплементация → рефлексия
- Результат (план/имплементация/рефлексия) персистится в сессию
- **AgentOrchestrator** (architect → coder) реализует план, **ReviewerAgent** проверяет каждый AC

### 🔍 Standalone AI-ревью
- Команда «LLM Assistant: Review File» — ревью активного файла или выделения
- Структурированный отчёт: стиль / безопасность / корректность / оптимизация
- Компактная сводка в сайдбаре → широкое окно с полным отчётом
- Правила из `.llma/agents/reviewer.md` подхватываются автоматически

### ⚡ Слэш-команды
- `/explain`, `/doc`, `/test`, `/review`, `/improve` (+ `/explain_stepbystep`) — по выделенному коду
- Автокомплит при вводе `/` или `@`: встроенные команды + скилы из `.llma/skills/` + `@orchestrate`

### 🎭 Multi-Agent (`@orchestrate`)
- Цепочка агентов **architect → coder → reviewer** (роли настраиваются в `.llma/agents/`)
- **3 стратегии**: `sequential`, `parallel`, `pipeline`
- Вкладка «Оркестратор»: дерево воркеров со статусами, прогресс, детали по клику
- **SharedContext**: обмен артефактами между воркерами

### 🗂 Каталог скилов (`.llma/skills/`)
- Агент видит доступные скилы в system prompt, вызов через `/skill` или `/имя-скила`
- Frontmatter: `name`, `version`, `tools`, `description`

### 🏗 Harness-слои агента
- **AGENTS.md автоинжект** — правила проекта из `AGENTS.md` в корне workspace
- **Context Summary** — сжатие старых сообщений при переполнении контекста
- **Ретраи + таймауты** — exponential backoff при 429/5xx/сетевых ошибках
- **MCP-клиент** — внешние инструменты через Model Context Protocol (stdio)
- **Run History Dashboard** — вкладка «История» с таблицей всех запусков

### Прочее
- **Мульти-провайдер**: DeepSeek, Hermes, SiliconFlow, OpenAI и любые OpenAI-совместимые API
- **Vision**: анализ изображений через Qwen3-VL (SiliconFlow)
- **Сессии**: авто-именование, переключение, удаление, переименование, сохранение между сессиями
- **Индикатор контекста** с цветовой индикацией (синяя <80%, оранжевая >80%, красная >100%)
- **Стоимость токенов** после каждого ответа
- **Быстрые действия**: 🔧 Исправить, 💡 Объяснить, ⚡ Оптимизировать
- **Экспорт сессии** в `.md` / буфер обмена
- **Интеграция с Hermes**: кнопка «Поделиться»
- **Дебаг-режим**: логирование system prompt и запросов в Output Channel

---

## Полная конфигурация

Все настройки в `settings.json` VS Code (User или Workspace).

### Провайдеры (`llmAssistant.providers`)

```json
{
  "llmAssistant.providers": {
    "my-provider": {
      "baseUrl": "https://api.example.com/v1",
      "apiKey": "${API_KEY}",
      "models": ["model-name-1", "model-name-2"],
      "supportsVision": false,
      "systemPrompt": "Опциональный кастомный промпт"
    }
  }
}
```

| Поле | Тип | Описание |
|------|-----|----------|
| `baseUrl` | string | URL API (OpenAI-совместимый) |
| `apiKey` | string | Ключ API. Поддерживает `${ENV_VAR}` |
| `models` | string[] | Список доступных моделей |
| `supportsVision` | boolean | `true` для vision-моделей (изображения) |
| `systemPrompt` | string | Кастомный промпт для этого провайдера |

### Основные настройки

| Ключ | Тип | По умолчанию | Описание |
|------|-----|-------------|----------|
| `llmAssistant.defaultProvider` | string | `"openai"` | Провайдер по умолчанию |
| `llmAssistant.defaultModel` | string | `"gpt-4o"` | Модель по умолчанию |
| `llmAssistant.debug` | boolean | `false` | Дебаг-логирование в Output Channel `LLM Assistant` |

### Чат (`llmAssistant.chat`)

| Ключ | Тип | По умолчанию | Описание |
|------|-----|-------------|----------|
| `chat.systemPrompt` | string | `"Ты — AI-ассистент…"` | Системный промпт для чата |
| `chat.agentSystemPrompt` | string | `"Ты — AI-агент…"` | Системный промпт для агента |
| `chat.maxContextTokens` | number | `4096` | Максимум токенов контекста |
| `chat.includeOpenFile` | boolean | `true` | Прикреплять открытый файл к запросу |
| `chat.summaryEnabled` | boolean | `true` | Включить summary при переполнении |
| `chat.summaryModel` | string | `""` (текущая) | Модель для генерации summary |
| `chat.summaryTriggerTokens` | number | `2048` | Порог обрезанных токенов для запуска summary |

### Агент (`llmAssistant.agent` / `llmAssistant.apply`)

| Ключ | Тип | По умолчанию | Описание |
|------|-----|-------------|----------|
| `agent.model` | string | `"gpt-4o"` | Модель агентного режима (если не задана — `defaultModel`) |
| `agent.requireConfirmation` | boolean | `true` | Подтверждение перед записью/изменением файлов |
| `apply.allowedTools` | string[] | `[]` (все) | Список разрешённых инструментов агента |
| `apply.maxIterations` | number | `20` | Максимум шагов агента |
| `apply.requireConfirmation` | string[] | `["write_file","replace_in_file","run_terminal"]` | Инструменты, требующие подтверждения |

**Инструменты агента:** `read_file`, `write_file`, `replace_in_file`, `list_files`, `search_files`, `run_terminal`, `web_fetch`, `ask_user`, `delegate_to_agent`.

**Приоритет конфигурации:** `.vscode/llm-assistant.json` (workspace) > глобальные настройки VS Code.

Пример `.vscode/llm-assistant.json`:
```json
{
  "allowedTools": ["read_file", "search_files"],
  "requireConfirmation": ["run_terminal"]
}
```

### AGENTS.md (`llmAssistant.agentsMd`)

| Ключ | Тип | По умолчанию | Описание |
|------|-----|-------------|----------|
| `agentsMd.enabled` | boolean | `true` | Автоинжект AGENTS.md из корня workspace |

### Ретраи (`llmAssistant.retry`)

| Ключ | Тип | По умолчанию | Описание |
|------|-----|-------------|----------|
| `retry.enabled` | boolean | `true` | Включить ретраи |
| `retry.maxRetries` | number | `3` | Максимум повторных попыток |
| `retry.requestTimeout` | number | `60` | Таймаут запроса (секунды) |

### MCP (`llmAssistant.mcp`)

| Ключ | Тип | По умолчанию | Описание |
|------|-----|-------------|----------|
| `mcp.servers` | object[] | `[]` | Список MCP-серверов |

**Формат сервера:**
```json
{
  "name": "filesystem",
  "command": "npx",
  "args": ["-y", "@modelcontextprotocol/server-filesystem", "/path/to/dir"],
  "env": { "VAR": "value" },
  "enabled": true
}
```

| Поле | Тип | Описание |
|------|-----|----------|
| `name` | string | Уникальное имя сервера |
| `command` | string | Исполняемый файл (npx, node, python3 — spawn в PATH) |
| `args` | string[] | Аргументы командной строки |
| `env` | object | Переменные окружения |
| `enabled` | boolean | `false` чтобы временно отключить без удаления |

### Autocomplete (`llmAssistant.autocomplete`)

| Ключ | Тип | По умолчанию | Описание |
|------|-----|-------------|----------|
| `autocomplete.enabled` | boolean | `true` | Включить автокомплит |
| `autocomplete.debounceMs` | number | `500` | Задержка перед запросом (мс) |

---

## Multi-Agent — оркестратор (`@orchestrate`)

В 🤖 Агенте используй команду `@orchestrate`:

```
@orchestrate Создай REST API для списка задач на TypeScript
```

**Что происходит:**
1. Создаётся цепочка из 3 воркеров: **architect → coder → reviewer**
2. Каждый воркер получает контекст от предыдущего
3. Результаты стримятся в чат и во вкладку «🎭 Оркестратор»
4. История сохраняется в сессию

**Стратегии:**
| Стратегия | Описание |
|-----------|----------|
| `sequential` | Каждый следующий получает результат предыдущего |
| `parallel` | Все работают одновременно |
| `pipeline` | Как sequential, но артефакты сохраняются в SharedContext |

**Вкладка «Оркестратор»:**
- Дерево воркеров с иконками (⏳ ожидание, 🔄 выполняется, ✅ готово, ❌ ошибка)
- Прогресс-бар
- Детали по клику (шаги, токены, ответ)

---

## Разработка

- **Стек:** TypeScript, VS Code Extension API, WebView, Webpack
- **Тесты:** Mocha + Sinon (335 mocked), E2E в реальном VS Code (18 тестов), GitHub Actions CI
- **SDD:** 26 spec-файлов (`specs/`), валидатор, pre-commit + CI
- **Репозиторий:** github.com/alekseyber/vscode-llm-assistant
- **Спецификации:** [specs/](https://github.com/alekseyber/vscode-llm-assistant/tree/main/specs) — 26 компонентов, интерфейсы, контракты, AC
- **Changelog:** [CHANGELOG.md](CHANGELOG.md)

```bash
npm install
npm run compile        # Сборка
npm run lint           # Линтер
npm run test:mocked    # Тесты без VS Code (335 шт.)
node scripts/spec-validate.js  # Проверка SDD
```

**Запуск в режиме разработки:** F5 → «Run Extension» → Extension Development Host.

**Установка локальной сборки:**
```bash
rm -rf ~/.vscode-server/extensions/alekseyber.vscode-llm-assistant-*
code --install-extension vscode-llm-assistant-0.11.0.vsix
```

## Лицензия

MIT
