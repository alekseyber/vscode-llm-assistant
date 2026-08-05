# Release Notes — v0.6.0

## 🏗 Harness-слои — превращение LLM в надёжного исполнителя

6 новых слоёв инфраструктуры агента, превращающих плагин из просто чата в полноценную среду разработки с AI.

### 01. System Policy — AGENTS.md автоинжект
- Файл `AGENTS.md` в корне workspace автоматически добавляется в system prompt
- Кеширование с авто-инвалидацией при изменении файла
- Отключение через `llmAssistant.agentsMd.enabled: false`

### 04. Context Management — Summary при переполнении
- При превышении `maxContextTokens` старые сообщения сжимаются в summary
- Summary вставляется как второе system-сообщение
- Настройки: `chat.summaryEnabled`, `chat.summaryModel`, `chat.summaryTriggerTokens`

### 06. Reliability & Safety — Ретраи + таймауты
- Exponential backoff с jitter (±25%): 1s → 2s → 4s
- Ретрай на 429, 5xx, сетевые ошибки
- Без ретрая на 400, 401, 403, 404
- Настраиваемый таймаут (`retry.requestTimeout`, секунды)
- Индикация в WebView: «⚠️ Повторная попытка 1/3...»
- Отключение: `retry.enabled: false`

### 02. Tool Contracts — Allow-list инструментов
- Ограничение доступных агенту инструментов через `apply.allowedTools`
- Подтверждение опасных операций: `apply.requireConfirmation`
- Приоритет: `.vscode/llm-assistant.json` > глобальные настройки

### 05. Common Interfaces — MCP-клиент
- Подключение внешних инструментов через Model Context Protocol (stdio)
- Фильтрация MCP-инструментов через allow-list
- Graceful degradation: ошибка одного сервера не ломает агента
- Поле `enabled: false` для временного отключения серверов

### 07. Product Shell — Run History Dashboard
- Вкладка «История» в Activity Bar с таблицей запусков
- Колонки: дата, режим, задача, шаги, токены, статус
- Фильтр по режиму (чат/агент/edit)
- Детали запуска по клику
- Очистка истории с подтверждением
- Персистентность через globalState (100 записей FIFO)

## 🎨 UI
- Контекст-бар: синий <80%, оранжевый >80%, красный пульсирующий >100%
- Иконка очистки ✖️ вместо 🧹
- Индикатор ретраев в WebView (жёлтая полоска)

## 🛠 Конфигурация
- Все настройки вынесены в `package.json` с дефолтами
- Полный справочник — в README.md

## 🧪 Тестирование
- 187 тестов (включая 2 новых интеграционных)
- `npm run test:mocked` — тесты без VS Code GUI

## 🐛 Исправлено
- Контекст-бар сбрасывается при переключении сессий
- Приветственное сообщение скрывается при наличии истории
- `flex: 1` в контекст-баре заменён на фиксированную ширину
- `Date.now()` → `crypto.randomUUID()` в createSession (коллизии ID)
- `confirm()` в WebView → `vscode.window.showWarningMessage`
- ESLint конфиг: `.eslintrc.json` + `--ext .ts`
- CI: `npm run compile` перед тестами

---

## Changelog

### v0.6.0
- feat: harness-слои (AGENTS.md, Summary, Retry, Allow-list, MCP, Dashboard)
- feat: Run History Dashboard в Activity Bar
- feat: MCP-клиент с фильтрацией через allow-list
- feat: контекст-бар с цветовой индикацией переполнения
- feat: индикация ретраев в WebView
- feat: дебаг-канал `LLM Assistant` в Output
- feat: 2 интеграционных теста (AGENTS.md + Summary)
- fix: сброс контекст-бара при переключении сессий
- fix: `crypto.randomUUID()` вместо `Date.now()`
- fix: скрытие приветствия при истории
- fix: ESLint конфиг
- fix: CI компиляция перед тестами
- docs: README с полной конфигурацией

### v0.5.3
- fix: restoreHistory всегда очищает контейнер

### v0.5.2
- ci: GitHub Actions — авто-прогон тестов

### v0.5.0
- feat: UI overhaul — плашки, контекст-бар, быстрые действия

### v0.1.0
- Начальный релиз: 4 режима, мульти-провайдер
