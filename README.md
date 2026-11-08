# VS Code LLM Assistant

![Test](https://github.com/alekseyber/vscode-llm-assistant/actions/workflows/test.yml/badge.svg)
![SDD Check](https://github.com/alekseyber/vscode-llm-assistant/actions/workflows/sdd-check.yml/badge.svg)
![VS Marketplace Version](https://img.shields.io/visual-studio-marketplace/v/alekseyber.vscode-llm-assistant)
![License](https://img.shields.io/badge/license-MIT-blue)

**AI-агент для VS Code, который умеет работать полностью локально.** Чат, inline-правки, автокомплит и ReAct-агент с инструментами — через любой OpenAI-совместимый API **или** через Ollama на твоей машине, без единого токена наружу.

```bash
code --install-extension alekseyber.vscode-llm-assistant
```

![Демо](media/demo.gif)

| Режим | Клавиши | Назначение |
|-------|---------|-----------|
| 💬 **Chat** | Боковая панель | Чат с контекстом кода, стриминг, индикатор токенов и стоимости |
| ✏️ **Edit** | `Ctrl+Alt+I` / `Cmd+Option+I` (macOS) | Выделил код → инструкция → diff → Accept/Reject |
| ⚡ **Autocomplete** | Tab/Escape | Ghost text на паузе печати |
| 🤖 **Agent** | Вкладка в чате | ReAct-агент с инструментами, MCP, подтверждениями и оркестрацией |

## Почему этот, а не Copilot / Cursor

| | Здесь | Copilot / Cursor |
|---|---|---|
| Работает офлайн | ✅ Ollama, запросы не покидают машину | ❌ нужен облачный аккаунт |
| Стоимость | твои ключи по прайсу провайдера или `$0` локально | подписка от $10/мес |
| Провайдер | любой OpenAI-совместимый + Ollama | только свой |
| Агент с инструментами | ✅ ReAct, MCP, мультиагент | ✅ (Cursor) |
| Телеметрия | нет | есть |

## Локальные модели (Ollama) — без облака

Тот же чат, агент и автокомплит, но ни один запрос не уходит в интернет. Провайдер работает на **нативном** `/api/chat`: OpenAI-совместимый `/v1` у Ollama не умеет отключать рассуждение, и thinking-модель (`qwen3:8b`) отвечает пустым текстом.

```json
{
  "llmAssistant.providers": {
    "local": { "type": "ollama", "baseUrl": "http://127.0.0.1:11434", "models": [] }
  }
}
```

- **`models: []`** — список моделей подтянется с сервера (`/api/tags`), вручную прописывать не нужно
- **Проверка сервера:** команда `LLM Assistant: Проверить локальный сервер` — версия, модели, размеры, capabilities (`tools` / `thinking` / `vision`)
- **Стоимость:** локальные модели считаются бесплатными (в статистике токенов `$0`, а не выдуманная цена)
- **Vision:** поддержка изображений определяется по capability `vision` из `/api/show`, вручную `supportsVision` задавать не нужно. Если модель без vision — плагин предупредит, что картинка не отправлена
- **Сводка изменений:** каждый агентский прогон заканчивается строкой `📝 Изменено файлов: N` (или `📝 Файлы не изменялись`) — видно, когда модель сказала «готово», не тронув файлы
- **Агентский цикл выключен по умолчанию** (`llmAssistant.local.toolLoop`): модели до 8B выдумывают результаты инструментов вместо чтения — ошибка выглядит как ответ
- **Ожидаемые скорости на CPU:** `gemma3:4b` — 8 с на короткий ответ, `qwen3:8b` с `think: false` — ~5 с, агентский шаг — до 50 с. Это диалог «на подумать», не замена облаку

## Скриншоты

**Чат-панель** — сайдбар сессий, тулбар, тумблеры режимов (Ask/Agent/План/Субагенты):

![Чат-панель](media/chat.jpg)

**Сайдбар сессий** — поиск, группировка «Сегодня», избранное:

![Сайдбар сессий](media/sessions.jpg)

**Агентный режим** — дружелюбные шаги + свёрнутый трейс «🔧 Выполнено N шагов»:

![Агентный режим](media/agent.jpg)

**Подтверждение операций** — инлайн-дифф перед записью файла:

![Подтверждение операций](media/confirm.jpg)

**Edit** — инлайн-дифф предложения правки:

![Edit-режим](media/edit.jpg)

**Autocomplete** — ghost text по мере ввода:

![Autocomplete](media/autocomplete.jpg)

**Субагенты (`@orchestrate`)** — экспорт с группировкой tool-шагов по воркерам:

![Субагенты](media/subagents.jpg)

## Установка

**Из Marketplace:**
```bash
code --install-extension alekseyber.vscode-llm-assistant
```

Или: VS Code → Extensions (`Ctrl+Shift+X`) → найти «LLM Assistant» → Install.

**Из `.vsix` (ручная установка):**
```bash
# ставится самый свежий файл из текущей папки — версию не нужно держать в голове
code --install-extension "$(ls -t vscode-llm-assistant-*.vsix | head -1)" --force
```

**Быстрый старт за 2 минуты — облако (нужен только ключ):**
1. `Ctrl+,` → в `settings.json` добавь провайдера (секция «Полная конфигурация» ниже)
2. Открой чат: иконка плагина в Activity Bar → 💬
3. Напиши сообщение — готово

**Быстрый старт без интернета — локальная модель:**

```
ollama pull gemma3:4b        # ~3.4 ГБ, работает и с картинками
```

```json
{ "llmAssistant.providers": { "local": { "type": "ollama", "baseUrl": "http://127.0.0.1:11434", "models": [] } } }
```

Дальше — `LLM Assistant: Проверить локальный сервер` в палитре, провайдер `local` в панели чата. Ни ключей, ни регистрации, ни отправки кода наружу.

## Возможности

### 🤖 Агентный кодинг
- **ReAct-агент** с инструментами: `read_file`, `write_file`, `replace_in_file`, `patch_file`, `list_files`, `search_files`, `run_terminal`, `web_fetch`, `ask_user`, `delegate_to_agent`
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
- **Защита от prompt injection** — результат `web_fetch` и MCP приходит модели в размеченном блоке «это данные, а не инструкции»; попытки перехвата команд и выманивания ключей (`.env`, `apiKey`, `~/.ssh`, `curl … | sh`) помечаются предупреждением
- **Поиск с ранжированием** — `search_files` учитывает `.gitignore`, не обрывается на 500 файлах, поднимает объявления символов выше случайных вхождений
- **Run History Dashboard** — вкладка «История» с таблицей всех запусков и фильтром по режиму (Чат / Агент / Edit); сводка над таблицей: суммарная и средняя стоимость, доля ошибок. Двойной клик по строке — детали прогона (провайдер, модель, шаги, токены, длительность)

### Прочее
- **Мульти-провайдер**: DeepSeek, Hermes, SiliconFlow, OpenAI и любые OpenAI-совместимые API
- **Vision**: анализ изображений через Qwen3-VL (SiliconFlow)
- **Сессии**: авто-именование, переключение, удаление, переименование, сохранение между сессиями
- **Индикатор контекста** с цветовой индикацией (синяя <80%, оранжевая >80%, красная >100%)
- **Стоимость токенов** после каждого ответа
- **Быстрые действия**: 🔧 Исправить, 💡 Объяснить, ⚡ Оптимизировать
- **Экспорт сессии** в `.md` / буфер обмена
- **Дебаг-режим**: логирование system prompt и запросов в Output Channel

---

## Чего здесь нет

Честный список, чтобы не тратить твоё время:

- **Нет телеметрии и аккаунта.** Расширение не собирает статистику и не требует регистрации
- **Нет своего индекса кодовой базы (RAG).** Контекст — открытый файл, выделение и то, что агент найдёт через `search_files` (поиск с ранжированием и учётом `.gitignore`). Полный локальный FTS5-индекс — в планах
- **Нет inline-чата в стиле Copilot** (`Ctrl+I` занят им же). Правка — `Ctrl+Alt+I` или правый клик → «Редактировать выделенный код»
- **Нет JetBrains и других IDE** — только VS Code 1.131+
- **Нет управляемых моделей.** Ключи, лимиты и счета — на стороне провайдера, не у нас

## Частые вопросы

**Это правда бесплатно?** Расширение — да, MIT. Платишь только провайдеру за токены; локальные модели — `$0`.

**Куда уходят данные?** К тому провайдеру, которого ты указал. С `type: "ollama"` — никуда: запросы идут на твою машину (`127.0.0.1:11434`).

**Работает без интернета?** Да, с локальной моделью: чат, агент и автокомплит не требуют сети.

**Чем отличается от Copilot / Cursor?** Работает офлайн, провайдер любой (включая Ollama), телеметрии нет, подписки нет — см. таблицу выше.

**Какие модели поддерживаются?** Любые OpenAI-совместимые API (DeepSeek, OpenAI, SiliconFlow, OpenRouter и т.п.) и Ollama. Проверка возможностей модели — `/api/show`: `tools`, `thinking`, `vision`.

**Нужен ли ключ?** Для облака — да, свой. Для локальных моделей — нет.

## Команды (Command Palette)

Все команды — через `Cmd/Ctrl+Shift+P` → «LLM Assistant: …».

| Команда | Действие |
|---------|----------|
| `LLM Assistant: Открыть чат` | Фокус на вкладку чата (`Ctrl+Alt+L`, на macOS `Cmd+Option+L`) |
| `LLM Assistant: Добавить выделение в контекст` | Прикрепить выделенный код к последнему сообщению |
| `LLM Assistant: Редактировать выделенный код` | Edit-режим: предложение открывается в diff-редакторе с кнопками «Принять/Отклонить» (`Ctrl+Alt+I`, на macOS `Cmd+Option+I`) |
| `LLM Assistant: Вкл/Выкл автокомплит` | Переключить автодополнение |
| `LLM Assistant: Запустить агентный режим` | Запустить ReAct-агента (`Ctrl+Shift+A`, на macOS `Cmd+Shift+A`) |
| `LLM Assistant: Выбрать провайдер` | Сменить провайдера / модель |
| `LLM Assistant: Открыть историю запусков` | Вкладка «История» (таблица прогонов, фильтр по режиму, сводка по стоимости) |
| `LLM Assistant: Review File` | Ревью активного файла или выделения |
| `LLM Assistant: Экспортировать сессию` | Экспорт транскрипции в `.md` (системный save-диалог) |
| `LLM Assistant: Скопировать сессию (fork)` | Копия активной сессии («… (копия)») |
| `LLM Assistant: Удалить все сессии` | Полная очистка (с модальным подтверждением) |
| `LLM Assistant: Проверить локальный сервер (Ollama)` | Версия, модели, размеры и capabilities локального Ollama |

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
| `type` | `"openai"` \| `"ollama"` | Тип провайдера. Не задан = `openai` (обратная совместимость). `ollama` — нативный `/api/chat` |
| `baseUrl` | string | URL API (OpenAI-совместимый; для `ollama` — `http://127.0.0.1:11434`) |
| `apiKey` | string | Ключ API. Поддерживает `${ENV_VAR}` |
| `models` | string[] или `{name, pricing}[]` | Список моделей; объектная форма задаёт цены для расчёта стоимости |
| `supportsVision` | boolean | `true` для vision-моделей (изображения) |
| `systemPrompt` | string | Кастомный промпт для этого провайдера |

**Цены моделей** (для подсчёта стоимости): вместо строки укажи объект:
```json
"models": ["deepseek-chat", { "name": "deepseek-v4-pro", "pricing": { "input": 0.435, "output": 0.87 } }]
```

### Основные настройки

| Ключ | Тип | По умолчанию | Описание |
|------|-----|-------------|----------|
| `llmAssistant.defaultProvider` | string | `"openai"` | Провайдер по умолчанию |
| `llmAssistant.defaultModel` | string | `"gpt-4o"` | Модель по умолчанию |
| `llmAssistant.debug` | boolean | `false` | Дебаг-логирование в Output Channel `LLM Assistant` |
| `llmAssistant.disableThinking` | boolean | `false` | Отключить режим размышлений (thinking) для deepseek-моделей в чате/агенте/редактировании. Экономит токены и ускоряет ответ |

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
| `agent.requireConfirmation` | boolean | `true` | Мастер-выключатель подтверждений: `false` — не спрашивать ни о чём (список ниже игнорируется) |
| `agent.maxIterations` | number | `15` | Максимум шагов агента в чате (было зашито 5) |
| `apply.allowedTools` | string[] | `[]` (все) | Список разрешённых инструментов агента |
| `apply.maxIterations` | number | `20` | Максимум шагов агента |
| `apply.requireConfirmation` | string[] | `["write_file","replace_in_file","patch_file","run_terminal"]` | Инструменты, требующие подтверждения (в apply-режиме — модальное окно с аргументами) |

**Инструменты агента:** `read_file`, `write_file`, `replace_in_file`, `patch_file`, `list_files`, `search_files`, `run_terminal`, `web_fetch`, `ask_user`, `delegate_to_agent`.

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

### Локальные модели (`llmAssistant.local`)

| Ключ | Тип | По умолчанию | Описание |
|------|-----|-------------|----------|
| `llmAssistant.local.think` | boolean | `false` | Гасить рассуждение (нативный флаг `think`). `true` — модель думает вслух: медленнее и рискует пустым ответом |
| `llmAssistant.local.numCtx` | number | `8192` | Окно контекста модели (`num_ctx`). Не путать с `chat.maxContextTokens` — это бюджет истории чата |
| `llmAssistant.local.requestTimeout` | number | `300` | Таймаут шага, секунды. На CPU шаг легко занимает 30–60 с |
| `llmAssistant.local.toolLoop` | boolean | `false` | Разрешить агентский цикл для локальной модели (см. предупреждение выше) |

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
| `edit.showProposalDiff` | boolean | `true` | Открывать предлагаемую правку в diff-редакторе: слева файл как есть, справа результат |

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

## Настройка агентов — `.llma/`

Создай папку `.llma/` в корне проекта:

```
проект/
├── AGENTS.md                 ← правила проекта (стандарт)
└── .llma/
    ├── main.md               ← правила главного агента (чат + 🤖)
    ├── agents/
    │   ├── architect.md      ← роли для @orchestrate и делегирования
    │   ├── coder.md
    │   └── reviewer.md
    ├── skills/
    │   └── my-skill.md       ← кастомный скил (вызов: /my-skill)
    └── plans/                ← планы План-режима (создаётся автоматически)
```

Коротко:

- **`.llma/main.md`** — правила проекта для чата и агента, подхватываются автоматически;
- **`.llma/agents/{role}.md`** — роль для `@orchestrate`, делегирования и ревью. Приоритет: файл роли → `main.md` → встроенная роль (`architect`, `coder`, `reviewer`);
- **`.llma/skills/{name}.md`** — скилы. Frontmatter `name`, `version`, `description`, `tools`; `description` решает, выберет ли агент скил сам;
- **`.llma/plans/`** — планы План-режима с разделом AC, по нему потом проверяется реализация.

Все файлы опциональны: если их нет — работают дефолтные промпты.

📖 Полный справочник: [docs/llma.md](docs/llma.md) — что куда инжектится, порядок приоритетов, формат скила и плана, лимиты, частые ошибки.

---

## Устранение проблем

### Локальные модели (Ollama)

| Симптом | Причина и решение |
|---------|-------------------|
| «Не удалось подключиться к Ollama» | Сервер не запущен (`ollama serve`), неверный `baseUrl`, или Ollama на другой машине — нужен SSH-туннель: `ssh -N -L 11434:localhost:11434 <host>` |
| «Модель не найдена на сервере Ollama (404)» | Модель не скачана: `ollama pull <model>` (имя — как в `/api/tags`, например `qwen3:8b`) |
| Ответ приходит пустым | Thinking-модель израсходовала лимит на рассуждение. `llmAssistant.local.think = false` и/или увеличьте `chat.maxContextTokens` |
| Ответ идёт 30–60 секунд | Норма для CPU-инференса 7–8B. Для быстрых ответов берите модель 3–4B |
| Агент не работает на локальной модели | Так и задумано: `llmAssistant.local.toolLoop = false`. Включайте осознанно — модели ≤8B выдумывают результаты инструментов |
| Портить ли порт наружу | Не нужно: у Ollama нет аутентификации. Держите `127.0.0.1` и ходите через туннель |



| Проблема | Решение |
|----------|---------|
| «Неверный API ключ» | Проверь `apiKey` в настройках или env-переменную |
| «Сервер не отвечает» | Проверь `baseUrl` и интернет |
| «Лимит запросов» (429) | Подожди или смени провайдера |
| Автокомплит не работает | Проверь `autocomplete.enabled` |
| Агент не вызывает инструменты | Убедись, что провайдер поддерживает function calling |
| Агент завис | Нажми ⏹️ (отмена) или увеличь `apply.maxIterations` |
| Логи | Output → канал `LLM Assistant` (`llmAssistant.debug: true`) |

---

## Разработка

- **Стек:** TypeScript, VS Code Extension API, WebView, Webpack
- **Тесты:** Mocha + Sinon (449 mocked), E2E в реальном VS Code (22 теста), GitHub Actions CI
- **SDD:** 41 spec-файлов (`specs/`), валидатор, pre-commit + CI
- **Репозиторий:** github.com/alekseyber/vscode-llm-assistant
- **Спецификации:** [specs/](https://github.com/alekseyber/vscode-llm-assistant/tree/main/specs) — 38 компонентов (+3 мета-документа), интерфейсы, контракты, AC
- **Changelog:** [CHANGELOG.md](CHANGELOG.md)

```bash
npm install
npm run compile        # Сборка
npm run lint           # Линтер
npm run test:mocked    # Тесты без VS Code (551 шт.)
node scripts/spec-validate.js  # Проверка SDD
```

**Запуск в режиме разработки:** F5 → «Run Extension» → Extension Development Host.

**Сборка и установка локально (любая версия, без указания номера):**
```bash
npx @vscode/vsce package                       # → vscode-llm-assistant-<версия>.vsix
rm -rf ~/.vscode-server/extensions/alekseyber.vscode-llm-assistant-*
code --install-extension "$(ls -t vscode-llm-assistant-*.vsix | head -1)" --force
code --list-extensions --show-versions | grep alekseyber   # проверить версию
```

`ls -t … | head -1` берёт самый новый VSIX в папке, поэтому команда не устаревает вместе с номером версии. Если файл лежит в другой папке — подставь путь: `code --install-extension ~/projects/vscode-llm-assistant/vscode-llm-assistant-*.vsix` (берёт первый по алфавиту, лучше явный `ls -t`).

## Лицензия

MIT
