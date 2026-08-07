---
component: AgentOrchestrator
version: 0.8.0
status: beta
since: 0.7.0
---

## Назначение

Оркестратор multi-agent выполнения. Принимает задачу и список ролей, создаёт AgentWorker'ов, запускает по стратегии, собирает результаты.

## Интерфейс

### `new AgentOrchestrator(onLog?, onWorkerStart?, onWorkerDone?)`

| Параметр | Тип | Описание |
|----------|-----|----------|
| `onLog` | `(msg: string) => void` | Логирование |
| `onWorkerStart` | `(roleName: string) => void` | Воркер начал работу |
| `onWorkerDone` | `(roleName: string, error?: string) => void` | Воркер завершил |

### `orchestrator.execute(task, provider, extraTools?) → MultiAgentResult`

| Параметр | Тип |
|----------|-----|
| `task.id` | `string` |
| `task.goal` | `string` |
| `task.roles` | `AgentRole[]` |
| `task.strategy` | `'parallel' \| 'sequential' \| 'pipeline'` |
| `provider` | `any` — LLM-провайдер |
| `extraTools` | `ToolSchema[]` — MCP-инструменты |

| Выход (`MultiAgentResult`) | Тип |
|---------------------------|-----|
| `workers` | `WorkerTaskResult[]` |
| `totalInputTokens` | `number` |
| `totalOutputTokens` | `number` |
| `success` | `boolean` |
| `summary` | `string` |

## Стратегии

| Стратегия | Поведение | Контекст |
|-----------|-----------|----------|
| `parallel` | Все воркеры запускаются одновременно (Promise.all) | Изолированы |
| `sequential` | Каждый получает результат предыдущего | `previousResult` в prompt |
| `pipeline` | Аналогично sequential, но артефакты накапливаются | `artifacts[]` в prompt |

## Контракты

| Ситуация | Поведение |
|----------|-----------|
| Ошибка воркера в parallel | Изолируется, другие продолжают |
| Ошибка воркера в sequential | Цепочка прерывается |
| `extraTools` передан | Пробрасывается каждому AgentWorker |
| Результаты воркеров | Сохраняются в `SharedContext` |

## AC

| ID | Критерий | Статус |
|----|----------|--------|
| MA-2.1 | execute() создаёт воркеров для каждой роли | ✅ |
| MA-2.2 | parallel запускает всех воркеров одновременно | ✅ |
| MA-2.3 | sequential передаёт контекст между воркерами | ✅ |
| MA-2.4 | MultiAgentResult содержит полную статистику | ✅ |
| MA-2.5 | Ошибка воркера изолируется | ✅ |
| MA-2.6 | extraTools передаётся воркерам | ✅ |

## Связи

- **Использует:** `AgentWorker`, `AgentSharedContext`
- **Используется:** `ChatViewProvider.handleOrchestrate`
- **Точка входа:** команда `@orchestrate` в 🤖 Агенте

## Детали реализации

- **Стратегии:** parallel = Promise.all, sequential = предыдущий результат в prompt, pipeline = накопление artifacts[]
- **Контекст передачи:** sequential — `\n## Результат предыдущего этапа:\n{result}`; pipeline — `\n## Артефакты:\n{artifacts}`
- **Изоляция ошибок:** parallel — ошибка воркера изолируется; sequential/pipeline — цепочка прерывается
- **SharedContext:** результаты как `result:{name}` и `artifact:{name}`
- **Summary:** конкатенация через `\n\n`

## Тесты (agentOrchestrator.test.ts, 9 тестов)

- MA-2.1: execute() создаёт воркеров для каждой роли
- MA-2.2: parallel запускает всех одновременно, собирает ответы
- MA-2.3: sequential передаёт контекст между воркерами, прерывает цепочку при ошибке
- MA-2.4: MultiAgentResult содержит полную статистику (токены, success, summary)
- MA-2.5: ошибка воркера изолируется (parallel), останавливает цепочку (sequential)
- pipeline: воркеры выполняются последовательно с артефактами
- onLog: колбэк вызывается при логировании

## История изменений

| Версия | Дата | Изменения |
|--------|------|-----------|
| 0.8.0 | 2026-08-06 | extraTools в execute() и всех стратегиях |
| 0.7.0 | 2026-08-05 | Базовая реализация (parallel/sequential/pipeline) |
