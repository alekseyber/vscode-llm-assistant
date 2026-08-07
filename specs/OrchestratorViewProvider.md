---
component: OrchestratorViewProvider
version: 0.8.0
status: stable
since: 0.7.0
---

## Назначение

WebView-вкладка «🎭 Оркестратор» в Activity Bar. Отображает текущую multi-agent задачу, дерево воркеров, прогресс-бар, детали шагов.

## Интерфейс

### `new OrchestratorViewProvider()`

### `resolveWebviewView(wv, ctx, token)` — точка входа WebView

### `showTask(task: OrchestratorTaskInfo)` — показать новую задачу

### `updateWorker(roleName, updates)` — обновить статус воркера

### `clear()` — очистить панель

## OrchestratorTaskInfo

| Поле | Тип |
|------|-----|
| taskId, goal, strategy | string |
| workers | WorkerInfo[] |
| totalWorkers, completedWorkers | number |
| progress | 0-100 |

## WorkerInfo

| Поле | Тип |
|------|-----|
| roleName | string |
| status | 'pending' \| 'running' \| 'done' \| 'error' |
| steps, inputTokens, outputTokens | number |
| answer?, error? | string |

## Контракты

| Ситуация | Поведение |
|----------|-----------|
| WebView загружен | Отправка текущей задачи |
| Обновление несуществующего воркера | Игнорируется |
| Прогресс | done / total * 100 |

## Связи

- **Используется:** ChatViewProvider.handleOrchestrate
- **Регистрация:** `package.json` → `llmAssistant.orchestrator`

## История изменений

| Версия | Дата | Изменения |
|--------|------|-----------|
| 0.7.0 | 2026-08-05 | Базовая реализация |
