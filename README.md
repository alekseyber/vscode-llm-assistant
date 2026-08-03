# VS Code LLM Assistant

**AI-ассистент для VS Code** — диалог с LLM в 4 режимах: чат, редактирование кода, автокомплит и агентный кодинг.

| Режим | Назначение |
|-------|-----------|
| 💬 **Chat** | Боковая панель чата с LLM. Поддержка контекста кода (выделение, файл целиком) |
| ✏️ **Edit** | Выделил код → `Ctrl+I` → инструкция → diff → Accept/Reject |
| ⚡ **Autocomplete** | Ghost text на паузе печати (`Tab` — принять, `Escape` — отклонить) |
| 🤖 **Apply** | Агентный режим: ReAct-цикл, инструменты (read/write/patch/search/terminal) |

## Конфигурация провайдеров

Поддерживаются любые OpenAI-совместимые API.

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

## Разработка

- **Стек:** TypeScript, VS Code Extension API, WebView, Webpack
- **План:** `PLAN.md` — детальный план реализации с критериями приёмки
- **Репозиторий:** приватный `github.com/alekseyber/vscode-llm-assistant`

### Запуск дебага

```bash
npm install
npm run compile
# VS Code → F5 → Extension Development Host
```

## Лицензия

MIT