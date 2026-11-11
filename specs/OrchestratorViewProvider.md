---
component: OrchestratorViewProvider
version: 0.8.3
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

## Детали реализации

- **HTML:** инлайн в `getHtml()`
- **CSS:** переменные VS Code (`--vscode-*`)
- **Прогресс:** `done/total*100`, `width .3s`
- **Статусы:** ⏳🔄✅❌, классы status-pending/running/done/error
- **Escape:** `replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;')`


## Тесты (orchestratorView.test.ts, 10 тестов)

- MA-4.1: viewType = llmAssistant.orchestrator, конструктор без ошибок
- MA-4.2: showTask сохраняет задачу с деревом воркеров
- MA-4.3: updateWorker меняет статус и прогресс; не падает для неизвестного
- MA-4.4: прогресс = done / total * 100
- MA-4.5: WorkerInfo содержит поля, с ошибкой содержит error
- clear: очищает панель без ошибок; OrchestratorTaskInfo заполнен
- `e2e/orchestrate.e2e.ts` (`E2E-15`) — сквозной путь `@orchestrate` из панели чата: роли берутся
  из `.llma/agents/NN-*.md` в порядке имён, `taskUpdate` приходит с тремя воркерами в `pending`,
  затем `workerUpdate` даёт `running → done` по каждой роли в том же порядке, итог доходит в чат,
  прогон записывается в историю с `mode: 'agent'`. Провал роли и отмена — зона юнитов

## История изменений

| Версия | Дата | Изменения |
|--------|------|-----------|
| 0.8.3 | 2026-11-11 | Правки ревью Pro по `E2E-15`: не фиксируется число обновлений и строгий порядок старта, проверяется передача результата предыдущей роли в промпт следующей, число запросов ограничено потолком итераций, убран мёртвый код; в спеке зафиксировано, что защищает тест (сквозной путь и передача контекста) и что нет (провал роли, отмена, рендер дерева) |
| 0.8.2 | 2026-11-11 | Уточнено поведение статусов по `E2E-15`: `done` приходит дважды на роль — сначала от воркера (только статус), затем с деталями (шаги, ответ, токены); e2e проверяет порядок по первому появлению и наличие деталей во втором обновлении |
| 0.8.1 | 2026-11-11 | Сообщения `taskUpdate`/`workerUpdate` уходят **снимком**: без копии в сообщении лежала ссылка на `currentTask`, и последующие обновления меняли уже отправленное (нашёл `E2E-15`; в реальном webview маскировалось сериализацией) |
| 0.8.0 | 2026-11-11 | e2e `E2E-15`: цепочка `@orchestrate` от сообщения в чате до статусов в дереве и записи в истории — проверяется порядок ролей и переходы статусов, а не качество ответов |
| 0.7.0 | 2026-08-05 | Базовая реализация |
