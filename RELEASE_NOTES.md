# Release Notes — v0.7.0

## 🎭 Multi-Agent Harness — MVP

Плагин становится оркестратором. Один `@orchestrate` — и агент разбивает задачу на этапы, выполняет параллельно или последовательно.

### AgentWorker
- Изолированные агенты с настраиваемой ролью (systemPrompt, allowedTools, модель)
- Каждый воркер работает в своём контексте, не задевая другие
- Проброс ошибок провайдера в оркестратор

### AgentOrchestrator
- 3 стратегии: **parallel** (Promise.all), **sequential** (контекст), **pipeline** (артефакты)
- Изоляция ошибок: падение одного воркера не роняет весь оркестратор
- Сводный отчёт: токены, ответы, ошибки всех воркеров

### AgentSharedContext
- Общий реестр артефактов между воркерами
- Воркеры читают результаты друг друга через SharedContext
- Авто-сохранение результатов после каждого воркера

### UI: Вкладка «Оркестратор»
- Дерево воркеров с иконками статуса (⏳/🔄/✅/❌)
- Прогресс-бар и счётчик
- Клик по воркеру — детали (шаги, токены, ответ)
- Живое обновление через postMessage

### Интеграция в агентный режим
- Команда `@orchestrate задача` в 🤖 Агенте
- 3 роли по умолчанию: architect → coder → reviewer
- Результаты стримятся в чат и сохраняются в историю

---

## 🏗 Harness-слои (v0.6.0+)

### 01. System Policy — AGENTS.md автоинжект
- Файл `AGENTS.md` автоматически добавляется в system prompt
- Кеширование с авто-инвалидацией
- Отключение: `llmAssistant.agentsMd.enabled: false`

### 04. Context Management — Summary
- Сжатие обрезанной истории в summary (чат + агент)
- Баг 400 исправлен: summaryModel не хардкодится как gpt-4o
- Дебаг-логирование всех этапов summarization

### 06. Reliability — Ретраи + таймауты
- Exponential backoff с jitter (±25%)
- Ретрай: 429, 5xx, сетевые ошибки. Без ретрая: 400, 401, 403, 404

### 02. Tool Contracts — Allow-list
- Ограничение инструментов через `apply.allowedTools`
- Подтверждение опасных операций через диалог
- `.vscode/llm-assistant.json` для per-project конфига

### 05. Common Interfaces — MCP-клиент
- stdio MCP-серверы с фильтрацией через allow-list
- Graceful degradation при ошибках

### 07. Product Shell — Run History Dashboard
- Вкладка «История»: таблица запусков, фильтр, детали
- Персистентность: 100 записей FIFO

---

## 🐛 Исправлено (v0.7.0)
- **Summary 400**: модель для summary берётся из настроек, не хардкодится
- **Контекст кода опаздывал**: attachCodeContext теперь ДО addMessage
- **AgentController не использовался**: summary добавлен в runAgentLoop ChatViewProvider
- **Дублирование user message**: addMessage вызывается один раз из правильного места

## 🎨 UI
- Контекст-бар: синий <80%, оранжевый >80%, красный пульсирующий >100%
- Вкладка «Оркестратор» рядом с «Чат» и «История»

## 🧪 Тестирование
- **226 тестов** (было 187): +10 AgentWorker, +9 AgentOrchestrator, +10 Communication, +10 OrchestratorView

---

## Changelog

### v0.7.0
- feat: Multi-Agent Harness MVP (AgentWorker, AgentOrchestrator, SharedContext)
- feat: вкладка «Оркестратор» с живым деревом воркеров
- feat: `@orchestrate` команда в агентном режиме
- feat: 3 стратегии оркестрации (parallel/sequential/pipeline)
- fix: summary 400 — модель не хардкодится
- fix: контекст кода не опаздывает
- fix: AgentController.summary интегрирован в runAgentLoop
- test: 39 новых тестов (226 total)

### v0.6.0
- feat: harness-слои (AGENTS.md, Summary, Retry, Allow-list, MCP, Dashboard)
- feat: Run History Dashboard
- feat: MCP-клиент
- feat: контекст-бар с цветовой индикацией

### v0.5.3
- fix: restoreHistory всегда очищает контейнер

### v0.5.2
- ci: GitHub Actions — авто-прогон тестов

### v0.5.0
- feat: UI overhaul — плашки, контекст-бар, быстрые действия

### v0.1.0
- Начальный релиз: 4 режима, мульти-провайдер
