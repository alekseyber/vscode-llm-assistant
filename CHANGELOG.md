# Changelog

## 0.8.0 (2026-08-06)

### Архитектурная унификация

- **AgentWorker — общий ReAct-движок:** `runAgentLoop` делегирует выполнение в `AgentWorker` с колбэками `onConfirm`, `extraTools` (MCP), `enableSummary`. Убран дублирующийся код из `ChatViewProvider`.
- **Динамические роли @orchestrate:** сканирование `.llma/agents/*.md`, порядок по префиксу (`01-architect.md`, `02-coder.md`), fallback на хардкод-тройку (architect/coder/reviewer).
- **MCP для оркестратора:** `extraTools` передаются в `AgentWorker` через `AgentOrchestrator`, одно подключение MCP на старте оркестратора.
- **Cost tracking:** расширенный формат `models: (string | {name, pricing})[]`, функция `calculateCost()` с таблицей fallback-цен (DeepSeek, GPT-4o, Claude, Qwen), `pricingMap` в `ProviderManager`.
- **Реальные токены из API:** `createWithTools` извлекает `usage.prompt_tokens` и `usage.completion_tokens`, `chars/4` как fallback.

## 0.7.0 (2026-08-05)

- Multi-agent harness: AgentWorker, AgentOrchestrator (parallel/sequential/pipeline), SharedContext
- OrchestratorViewProvider — вкладка «🎭 Оркестратор»
- Role-based AGENTS.md: `.llma/agents/{role}.md` с fallback на `main.md`
- Команда `@orchestrate` в чате

## 0.1.0 (2026-08-04)

- Инициализация проекта
- Базовая архитектура: 4 режима (chat, edit, autocomplete, apply)
- Provider Manager с OpenAI-совместимыми провайдерами
- PLAN.md с детальным планом реализации и критериями приёмки
