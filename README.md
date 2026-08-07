# VS Code LLM Assistant v0.8.2

**AI-ассистент для VS Code** — 4 режима работы с LLM через любые OpenAI-совместимые API.

| Режим | Клавиши | Назначение |
|-------|---------|-----------|
| 💬 **Chat** | Боковая панель | Чат с контекстом кода, стриминг, индикатор токенов |
| ✏️ **Edit** | `Ctrl+I` | Выделил код → инструкция → diff → Accept/Reject |
| ⚡ **Autocomplete** | Tab/Escape | Ghost text на паузе печати |
| 🤖 **Agent** | Вкладка в чате | ReAct-агент с инструментами, делегированием, MCP, оркестрацией |

## Что нового в v0.7.0

### 🎭 Multi-Agent Harness (MVP)
- **Вкладка «Оркестратор»** — панель для мониторинга multi-agent задач
- **`@orchestrate` команда** — запуск цепочки агентов в 🤖 Агенте
- **3 стратегии**: parallel, sequential, pipeline
- **Роли**: architect → coder → reviewer (настраиваемые)
- **Живой прогресс**: древовидный UI со статусами (pending/running/done/error)
- **SharedContext**: обмен артефактами между воркерами
- **226 тестов** (включая 39 новых для multi-agent)

### 🏗 Harness-слои агента (v0.6.0+)
- **AGENTS.md автоинжект** — правила проекта из `AGENTS.md` в корне workspace автоматически добавляются в system prompt
- **Context Summary** — при переполнении контекста старые сообщения сжимаются в summary (чат + агент)
- **Ретраи + таймауты** — exponential backoff при 429/5xx/сетевых ошибках, настраиваемый таймаут
- **Allow-list инструментов** — ограничение доступных агенту инструментов через настройки или `.vscode/llm-assistant.json`
- **MCP-клиент** — подключение внешних инструментов через Model Context Protocol (stdio-серверы)
- **Run History Dashboard** — вкладка «История» с таблицей всех запусков, фильтром и деталями

### Существующие возможности
- **Мульти-провайдер**: DeepSeek, Hermes, SiliconFlow, OpenAI и любые OpenAI-совместимые API
- **6 инструментов агента**: `list_files`, `search_files`, `read_file`, `write_file`, `replace_in_file`, `run_terminal`
- **Подтверждение операций**: диалог подтверждения перед записью/изменением файлов
- **Vision**: анализ изображений через Qwen3-VL (SiliconFlow)
- **Сессии**: авто-именование, переключение, удаление, переименование, сохранение между сессиями VS Code
- **Индикатор контекста**: полоска заполнения с цветовой индикацией (синяя <80%, оранжевая >80%, красная пульсирующая >100%)
- **Стоимость токенов**: отображение после каждого ответа
- **Быстрые действия**: 🔧 Исправить, 💡 Объяснить, ⚡ Оптимизировать
- **Экспорт сессии**: сохранение в .md и копирование в буфер
- **Интеграция с Hermes**: кнопка «Поделиться» для передачи контекста
- **Дебаг-режим**: подробное логирование system prompt и запросов в Output Channel

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
| `chat.systemPrompt` | string | `"Ты — AI-ассистент..."` | Системный промпт для чата |
| `chat.agentSystemPrompt` | string | `"Ты — AI-агент..."` | Системный промпт для агента |
| `chat.maxContextTokens` | number | `4096` | Максимум токенов контекста |
| `chat.includeOpenFile` | boolean | `true` | Прикреплять открытый файл к запросу |
| `chat.summaryEnabled` | boolean | `true` | Включить summary при переполнении |
| `chat.summaryModel` | string | `""` (текущая) | Модель для генерации summary |
| `chat.summaryTriggerTokens` | number | `256` | Порог токенов для запуска summary |

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

### Агент / Allow-list (`llmAssistant.apply`)

| Ключ | Тип | По умолчанию | Описание |
|------|-----|-------------|----------|
| `apply.allowedTools` | string[] | `[]` (все) | Список разрешённых инструментов |
| `apply.requireConfirmation` | string[] | `["write_file","replace_in_file","run_terminal"]` | Инструменты, требующие подтверждения |

**Возможные значения для `allowedTools`:** `read_file`, `write_file`, `replace_in_file`, `list_files`, `search_files`, `run_terminal`, `patch_file`

**Приоритет конфигурации:** `.vscode/llm-assistant.json` (workspace) > глобальные настройки VS Code.

Пример `.vscode/llm-assistant.json`:
```json
{
  "allowedTools": ["read_file", "search_files"],
  "requireConfirmation": ["run_terminal"]
}
```

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
- **Тесты:** Mocha + Sinon (234 теста), GitHub Actions CI
- **SDD:** 26 spec-файлов (`specs/`), валидатор, pre-commit + CI
- **Репозиторий:** github.com/alekseyber/vscode-llm-assistant
- **Спецификации:** [specs/](https://github.com/alekseyber/vscode-llm-assistant/tree/main/specs) — 26 компонентов, интерфейсы, контракты, AC

```bash
npm install
npm run compile        # Сборка
npm run lint           # Линтер
npm run test:mocked    # Тесты без VS Code (234 шт.)
node scripts/spec-validate.js  # Проверка SDD
```

**Запуск в режиме разработки:** F5 → «Run Extension» → Extension Development Host.

**Установка локальной сборки:**
```bash
rm -rf ~/.vscode-server/extensions/alekseyber.vscode-llm-assistant-*
code --install-extension vscode-llm-assistant-0.8.2.vsix
```

## Лицензия

MIT
