# Changelog

## 0.8.2 (2026-08-07)

- Индикатор токенов в шапке чата (токены + стоимость + прогресс-бар)
- Сброс индикатора при смене сессии

## 0.8.1 (2026-08-07)

- MA-6: delegate_to_agent — делегирование подзадач между агентами
- MA-7: cost tracking per agent — WorkerResult.cost, totalCost, сводка
- Префиксы агентов: `\d{2}-` → цепочка, без префикса → делегирование
- loadAllAgentRoles() — все роли для делегирования
- recordChatRun в handleOrchestrate — стоимость в истории
- delegate maxIterations: 5 → 15

## 0.8.0 (2026-08-06)

- AgentWorker — общий ReAct-движок для чат-агента и оркестратора
- Динамические роли @orchestrate: .llma/agents/*.md, порядок по префиксу
- MCP для оркестратора: extraTools через AgentOrchestrator
- Cost tracking: ModelEntry = string | {name, pricing}, calculateCost()
- Реальные токены: usage.prompt_tokens/completion_tokens из API
- CI: spec-validate как отдельный job

## 0.7.0 (2026-08-05)

- Multi-agent harness: AgentWorker, AgentOrchestrator, SharedContext
- OrchestratorViewProvider — вкладка «🎭 Оркестратор»
- Role-based AGENTS.md: .llma/agents/{role}.md
- Команда @orchestrate в чате

## 0.1.0 (2026-08-04)

- Инициализация проекта
- Базовая архитектура: 4 режима (chat, edit, autocomplete, apply)
- Provider Manager с OpenAI-совместимыми провайдерами
