# Инструкция пользователя: VS Code LLM Assistant

**Версия:** v0.1.0
**Издатель:** alekseyber
**ID:** `alekseyber.vscode-llm-assistant`
**Marketplace:** https://marketplace.visualstudio.com/items?itemName=alekseyber.vscode-llm-assistant

---

## 1. Установка

### Через VS Code Extensions

```
1. Открой VS Code → Ctrl+Shift+X
2. Найди: "VS Code LLM Assistant"
3. Install
```

### Через терминал

```bash
code --install-extension alekseyber.vscode-llm-assistant
```

### Через .vsix файл

```bash
code --install-extension vscode-llm-assistant-0.1.0.vsix
```

---

## 2. Настройка провайдеров

Расширение работает с **любыми OpenAI-совместимыми API**. Настройки в:

```
File → Preferences → Settings (Ctrl+,) → поиск "llmAssistant"
```

### Пример конфигурации (settings.json)

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
    "siliconflow": {
      "baseUrl": "https://api.siliconflow.cn/v1",
      "apiKey": "${SILICONFLOW_API_KEY}",
      "models": ["deepseek-ai/DeepSeek-V4-Flash", "deepseek-ai/DeepSeek-V4-Pro"]
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

### Переменные окружения

Вместо `${VAR}` можно использовать реальные ключи, но безопаснее через env-переменные:

```bash
# Linux/macOS
export OPENAI_API_KEY="sk-..."
export DEEPSEEK_API_KEY="sk-..."

# Windows PowerShell
$env:OPENAI_API_KEY = "sk-..."
```

---

## 3. Все настройки

| Настройка | По умолчанию | Описание |
|-----------|-------------|----------|
| `llmAssistant.providers` | `{}` | Провайдеры (baseUrl, apiKey, models) |
| `llmAssistant.defaultProvider` | `openai` | Провайдер по умолчанию |
| `llmAssistant.defaultModel` | `gpt-4o` | Модель по умолчанию |
| `llmAssistant.autocomplete.enabled` | `true` | Вкл/выкл автокомплит |
| `llmAssistant.autocomplete.debounceMs` | `500` | Задержка перед запросом автокомплита |
| `llmAssistant.chat.maxContextTokens` | `4096` | Максимум токенов контекста чата |
| `llmAssistant.apply.maxIterations` | `20` | Максимум шагов агента |
| `llmAssistant.agent.model` | `gpt-4o` | Модель для агентного режима |
| `llmAssistant.debug` | `false` | DEBUG-логи в Output |

---

## 4. Команды и горячие клавиши

| Команда | Хоткей | Что делает |
|---------|--------|-----------|
| `llmAssistant.chat.focus` | `Ctrl+Shift+L` | Открыть чат |
| `llmAssistant.chat.addSelection` | — | Добавить выделение в контекст чата |
| `llmAssistant.edit.selection` | `Ctrl+I` | Редактировать выделенный код |
| `llmAssistant.autocomplete.toggle` | — | Вкл/Выкл автокомплит |
| `llmAssistant.apply.start` | `Ctrl+Shift+A` | Запустить агентный режим |
| `llmAssistant.selectProvider` | — | Выбрать провайдер/модель |

---

## 5. Режимы работы

### 💬 Chat
- `Ctrl+Shift+L` — открыть панель чата
- Выдели код → команда "Добавить выделение в контекст"
- Markdown-ответы, подсветка кода

### ✏️ Edit
1. Выдели код
2. `Ctrl+I` → введи инструкцию («добавить типы», «переписать на async/await»)
3. Посмотри diff → **Accept** или **Reject**

### ⚡ Autocomplete
- Просто печатай — через ~500мс появится ghost text
- `Tab` — принять, `Escape` — отклонить
- Отключить: `llmAssistant.autocomplete.enabled: false`

### 🤖 Apply (агентный режим)
1. `Ctrl+Shift+A` → опиши задачу («создай модуль логирования», «исправь баг в X»)
2. Агент читает/пишет/патчит файлы, ищет, запускает команды
3. Следи за прогрессом в панели, отмена — Esc
4. Финальный diff всех изменений

---

## 6. Устранение проблем

| Проблема | Решение |
|----------|---------|
| «Неверный API ключ» | Проверь `apiKey` в настройках или env-переменную |
| «Сервер не отвечает» | Проверь `baseUrl` и интернет-соединение |
| «Лимит запросов» | Подожди или смени провайдера (429) |
| Автокомплит не работает | Проверь `autocomplete.enabled`, настройку debounce |
| Агент завис | `Ctrl+Shift+A` повторно, или увеличь `apply.maxIterations` |
| Логи | Output panel → выбери канал `LLM Assistant` |

---

## 7. Смена провайдера на лету

```
1. Ctrl+Shift+P → "LLM Assistant: Выбрать провайдер"
2. Выбери провайдер из списка
3. Выбери модель
4. Все следующие запросы пойдут через него
```

---

## 8. Требования

- **VS Code** >= 1.131.0
- **Node.js** (не требуется пользователю — только для разработки)
- Интернет для запросов к API провайдеров

---

*Документация и исходный код: https://github.com/alekseyber/vscode-llm-assistant*