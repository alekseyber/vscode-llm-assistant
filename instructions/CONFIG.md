# Инструкция по установке и настройке VS Code LLM Assistant v0.7.0

## Установка

### Из Marketplace
```
code --install-extension alekseyber.vscode-llm-assistant
```

### Из .vsix (ручная)
```
code --install-extension vscode-llm-assistant-0.7.0.vsix
```

## Быстрый старт

1. Открой VS Code → Settings (`Cmd/Ctrl + ,`)
2. Добавь конфигурацию провайдера в `settings.json`
3. Открой чат: иконка плагина в Activity Bar → 💬 Чат
4. Напиши сообщение — готово

## Минимальная конфигурация

```json
{
  "llmAssistant.providers": {
    "deepseek": {
      "baseUrl": "https://api.deepseek.com/v1",
      "apiKey": "sk-your-key",
      "models": ["deepseek-chat"]
    }
  },
  "llmAssistant.defaultProvider": "deepseek",
  "llmAssistant.defaultModel": "deepseek-chat"
}
```

## Рекомендуемая конфигурация

```json
{
  "llmAssistant.providers": {
    "deepseek": {
      "baseUrl": "https://api.deepseek.com/v1",
      "apiKey": "${DEEPSEEK_API_KEY}",
      "models": ["deepseek-chat"]
    },
    "siliconflow": {
      "baseUrl": "https://api.siliconflow.com/v1",
      "apiKey": "${SF_API_KEY}",
      "models": ["deepseek-ai/DeepSeek-V4-Flash-0731"]
    },
    "vision": {
      "baseUrl": "https://api.siliconflow.com/v1",
      "apiKey": "${SF_API_KEY}",
      "models": ["Qwen/Qwen3-VL-32B-Instruct"],
      "supportsVision": true
    }
  },
  "llmAssistant.defaultProvider": "siliconflow",
  "llmAssistant.defaultModel": "deepseek-ai/DeepSeek-V4-Flash-0731",
  "llmAssistant.chat.maxContextTokens": 4096,
  "llmAssistant.chat.summaryEnabled": true,
  "llmAssistant.chat.summaryTriggerTokens": 256,
  "llmAssistant.retry.enabled": true,
  "llmAssistant.retry.maxRetries": 3,
  "llmAssistant.retry.requestTimeout": 60,
  "llmAssistant.apply.requireConfirmation": ["write_file", "run_terminal"],
  "llmAssistant.autocomplete.enabled": true,
  "llmAssistant.agentsMd.enabled": true,
  "llmAssistant.debug": false
}
```

## AGENTS.md

Создай файл `AGENTS.md` в корне проекта. Его содержимое будет автоматически добавлено в system prompt:

```markdown
## Правила
- Всегда отвечай с эмодзи 🚀
- Называй меня «Капитан»
- Комментарии в коде — на русском
```

Отключение: `"llmAssistant.agentsMd.enabled": false`

## MCP-серверы

Пример подключения filesystem-сервера:

```json
{
  "llmAssistant.mcp.servers": [
    {
      "name": "filesystem",
      "command": "npx",
      "args": ["-y", "@modelcontextprotocol/server-filesystem", "/path/to/project"],
      "enabled": true
    }
  ]
}
```

Временное отключение: `"enabled": false`

## Allow-list инструментов

Ограничение доступных агенту инструментов (глобально):
```json
{ "llmAssistant.apply.allowedTools": ["read_file", "search_files"] }
```

Ограничение для конкретного проекта (`.vscode/llm-assistant.json`):
```json
{ "allowedTools": ["read_file"], "requireConfirmation": [] }
```

## Режимы работы

| Режим | Как активировать |
|-------|-----------------|
| 💬 Чат | Боковая панель, селект «💬 Чат» |
| 🤖 Агент | Селект «🤖 Агент» (требует провайдера с function calling) |
| 🎭 Оркестратор | Вкладка в Activity Bar (рядом с Чат и История) |
| ✏️ Edit | `Ctrl+I` на выделенном коде |
| ⚡ Autocomplete | Пауза при печати |

## Multi-Agent оркестрация — `@orchestrate`

В 🤖 Агенте используй команду:

```
@orchestrate Создай REST API для списка задач на TypeScript
```

**Как это работает:**
1. Создаётся цепочка из 3 воркеров: **architect → coder → reviewer**
2. Каждый воркер получает контекст от предыдущего
3. Результаты видны в чате и во вкладке «🎭 Оркестратор»
4. История сохраняется в сессию

### Схемы взаимодействия

**Sequential (по умолчанию) — цепочка:**

```
Пользователь: "@orchestrate задача"
         │
         ▼
┌─────────────────┐
│   Оркестратор    │
└────────┬────────┘
         │
    ┌────▼────┐
    │architect│  system: "Ты — архитектор..."
    │         │  user:   "задача"
    │  ответ  │
    └────┬────┘
         │ финальный ответ architect
    ┌────▼────┐
    │  coder  │  system: "Ты — программист..."
    │         │  user:   "задача\n## Результат архитектора:\n{ответ architect}"
    │  ответ  │
    └────┬────┘
         │ финальный ответ coder
    ┌────▼────┐
    │reviewer │  system: "Ты — ревьюер..."
    │         │  user:   "задача\n## Результат кодера:\n{ответ coder}"
    │  ответ  │
    └────┬────┘
         │
         ▼
   Сводный отчёт
```

**Parallel — одновременно:**

```
         ┌─────────────────┐
         │   Оркестратор    │
         └────────┬────────┘
                  │
     ┌────────────┼────────────┐
     ▼            ▼            ▼
┌─────────┐ ┌─────────┐ ┌─────────┐
│   w1    │ │   w2    │ │   w3    │
│ задача  │ │ задача  │ │ задача  │
└────┬────┘ └────┬────┘ └────┬────┘
     │            │            │
     └────────────┼────────────┘
                  ▼
           Сводный отчёт
```

**Pipeline — конвейер с артефактами:**

```
architect → DESIGN.md
              │
              ▼ (артефакт)
           coder → server.ts
                      │
                      ▼ (артефакт)
                   tester → test.ts + отчёт
```

**Контекст воркеров:**
- Каждый воркер — **чистый `messages[]` массив** (system + user)
- Не гоняется история tool calls предыдущих воркеров
- Только финальный ответ передаётся следующему

## Настройка агентов — `.llma/`

Создай папку `.llma/` в корне проекта:

```
проект/
└── .llma/
    ├── main.md              ← главный агент (чат + 🤖)
    └── agents/
        ├── architect.md     ← роль «архитектор»
        ├── coder.md         ← роль «программист»
        └── reviewer.md      ← роль «ревьюер»
```

### `.llma/main.md` — главный агент

```markdown
## Правила
- Всегда отвечай с эмодзи 🚀 в начале
- Называй меня «Капитан»
- Комментарии в коде — на русском
```

### `.llma/agents/architect.md` — архитектор

```markdown
Ты — архитектор ПО. Спроектируй структуру до написания кода.

## Правила
- Отвечай кратко, по-русски
- Предлагай структуру файлов и интерфейсов
- Используй таблицы для наглядности
- Не пиши реализацию — только архитектуру
```

### `.llma/agents/coder.md` — программист

```markdown
Ты — программист. Напиши рабочий код по спецификации.

## Правила
- Отвечай кратко, по-русски
- Пиши чистый код с комментариями на русском
- Обрабатывай ошибки и граничные случаи
- Добавляй типы (TypeScript) или аннотации (Python)
```

### `.llma/agents/reviewer.md` — ревьюер

```markdown
Ты — ревьюер кода. Найди проблемы и предложи улучшения.

## Правила
- Отвечай кратко, по-русски
- Ищи: ошибки, утечки, проблемы с типами
- Предлагай конкретные исправления
- Отмечай хорошие решения
```

Файлы опциональны. Если их нет — агенты используют дефолтные промпты.

## Дебаг

Включи `"llmAssistant.debug": true`, открой **View → Output → LLM Assistant** — там будет полный лог system prompt, AGENTS.md, отправляемых сообщений, MCP-подключений и логов оркестратора.

## Тестирование

```bash
git clone https://github.com/alekseyber/vscode-llm-assistant.git
cd vscode-llm-assistant
npm install
npm run compile
npm run test:mocked    # 226 тестов
```
