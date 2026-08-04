# VS Code LLM Assistant v0.5.3

**AI-ассистент для VS Code** — 4 режима работы с LLM через любые OpenAI-совместимые API.

| Режим | Клавиши | Назначение |
|-------|---------|-----------|
| 💬 **Chat** | `Ctrl+Shift+L` | Боковая панель чата с контекстом кода |
| ✏️ **Edit** | `Ctrl+I` | Выделил код → инструкция → diff → Accept/Reject |
| ⚡ **Autocomplete** | Tab/Escape | Ghost text на паузе печати |
| 🤖 **Agent** | Вкладка в чате | ReAct-агент с 6 инструментами |

## Возможности

- **Мульти-провайдер**: DeepSeek, Hermes, SiliconFlow, OpenAI и любые OpenAI-совместимые API
- **6 инструментов агента**: `list_files`, `search_files`, `read_file`, `write_file`, `replace_in_file`, `run_terminal`
- **Подтверждение операций**: git-diff диалог перед записью/изменением файлов
- **Vision**: анализ изображений через Qwen3-VL (SiliconFlow)
- **Сессии**: авто-именование, переключение, удаление, переименование
- **Стоимость токенов**: отображение после каждого ответа
- **Индикатор контекста**: полоска заполнения контекстного окна
- **Быстрые действия**: 🔧 Исправить, 💡 Объяснить, ⚡ Оптимизировать
- **Сворачивание кода**: блоки кода с кнопкой ▼/▶
- **Экспорт сессии**: сохранение в .md
- **Интеграция с Hermes**: кнопка «Поделиться» для передачи контекста

## Конфигурация провайдеров

Поддерживаются любые OpenAI-совместимые API. Настройка в `settings.json` VS Code:

```json
{
  "llmAssistant.providers": {
    "deepseek": {
      "baseUrl": "https://api.deepseek.com/v1",
      "apiKey": "${DEEPSEEK_API_KEY}",
      "models": ["deepseek-chat"]
    },
    "vision": {
      "baseUrl": "https://api.siliconflow.com/v1",
      "apiKey": "${SILICON_FLOW_AI_API_KEY}",
      "models": ["Qwen/Qwen3-VL-32B-Instruct"],
      "supportsVision": true
    },
    "hermes": {
      "baseUrl": "https://hermes-ai-api.alexfdev.ru/v1",
      "apiKey": "***",
      "models": ["deepseek-v4-pro"],
      "systemPrompt": "Кастомный промпт для этого провайдера"
    }
  },
  "llmAssistant.defaultProvider": "deepseek",
  "llmAssistant.defaultModel": "deepseek-chat"
}
```

- `apiKey` поддерживает `${ENV_VAR}` — подстановку из переменных окружения
- `supportsVision: true` — для vision-моделей (изображения)
- `systemPrompt` — кастомный промпт для конкретного провайдера

## Настройки

| Ключ | По умолчанию | Описание |
|------|-------------|----------|
| `llmAssistant.defaultProvider` | `"openai"` | Провайдер по умолчанию |
| `llmAssistant.defaultModel` | `"gpt-4o"` | Модель по умолчанию |
| `llmAssistant.chat.maxContextTokens` | 4096 | Максимум токенов контекста |
| `llmAssistant.chat.systemPrompt` | (текст) | Системный промпт для чата |
| `llmAssistant.chat.agentSystemPrompt` | (текст) | Системный промпт для агента |
| `llmAssistant.chat.includeOpenFile` | `true` | Прикреплять открытый файл к запросу |
| `llmAssistant.agent.requireConfirmation` | `true` | Запрашивать подтверждение перед записью |
| `llmAssistant.autocomplete.enabled` | `true` | Включить автокомплит |
| `llmAssistant.autocomplete.debounceMs` | 500 | Задержка перед запросом (мс) |

## Разработка

- **Стек:** TypeScript, VS Code Extension API, WebView, Webpack
- **Тесты:** Mocha + Sinon, GitHub Actions CI
- **Репозиторий:** github.com/alekseyber/vscode-llm-assistant

### Запуск дебага

```bash
npm install
npm run compile
# VS Code → F5 → Extension Development Host
```

### Запуск тестов

```bash
npm test  # внутри VS Code
```

## Лицензия

MIT
