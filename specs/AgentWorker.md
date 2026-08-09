---
component: AgentWorker
version: 0.8.0
status: stable
since: 0.7.0
---

## Назначение

Общий ReAct-движок для:
- **Чат-агента** (`ChatViewProvider.runAgentLoop`) — интерактивный режим с подтверждениями, MCP, summary
- **Оркестратора** (`AgentOrchestrator`) — headless-воркеры без UI

## Интерфейс

### `new AgentWorker(role, provider, options?)`

| Параметр | Тип | Описание |
|----------|-----|----------|
| `role` | `AgentRole` | Имя, systemPrompt, allowedTools, model |
| `provider` | `any` | LLM-провайдер с `createWithTools()` |
| `options.maxIterations` | `number` | Макс. итераций (по умолчанию 10) |
| `options.onStep` | `callback` | Логирование шагов |
| `options.extraTools` | `ToolSchema[]` | MCP-инструменты |
| `options.onConfirm` | `callback` | Подтверждение операций |
| `options.enableSummary` | `boolean` | Сжатие истории в цикле |

### `worker.run(task, initialMessages?) → WorkerResult`

| Вход | Описание |
|------|----------|
| `task` | Текст задачи (user message) |
| `initialMessages` | Готовый массив сообщений (для runAgentLoop) |

| Выход (`WorkerResult`) | Тип |
|------------------------|-----|
| `answer` | `string` — финальный ответ |
| `steps` | `AgentStep[]` — все шаги |
| `iterations` | `number` |
| `inputTokens` | `number` — из `usage.prompt_tokens` или chars/4 |
| `outputTokens` | `number` — из `usage.completion_tokens` или chars/4 |
| `cost` | `number` — стоимость в USD через `calculateCost()` |
| `error?` | `string` |

## Контракты

| Ситуация | Поведение |
|----------|-----------|
| `initialMessages` передан | Используется как есть (system + история) |
| `initialMessages` не передан | Строится: systemPrompt + task + SKILL_TEMPLATE + каталог скилов |
| `allowedTools` задан | Фильтруются схемы инструментов |
| `extraTools` задан | Добавляются к базовым из ChatAgentTools |
| `onConfirm` задан и tool требует подтверждения | Вызывается onConfirm, при false — операция пропускается |
| `enableSummary: true` и messages > 6 | Старые сообщения сжимаются в summary |
| `createWithTools` вернул `usage` | Токены из API, иначе chars/4 |
| `createWithTools` без tool_calls | Финальный ответ, завершение цикла |
| Исчерпан лимит итераций | `answer = 'Агент не дал финального ответа'` |
| После выполнения `ask_user` (если есть инжект ⚠️ на позиции 1) | Инжект удаляется из messages |
| LLM выбросил ошибку | Пробрасывается наверх (throw) |

## AC

| ID | Критерий | Статус |
|----|----------|--------|
| MA-1.1 | Конструктор сохраняет роль и провайдера | ✅ |
| MA-1.2 | systemPrompt роли передаётся в LLM | ✅ |
| MA-1.3 | allowedTools фильтрует инструменты | ✅ |
| MA-1.4 | Модель из AgentRole.model используется вместо глобальной | ✅ |
| MA-1.5 | run() возвращает WorkerResult с полным ответом и шагами | ✅ |
| MA-1.6 | extraTools добавляются к базовым инструментам | ✅ |
| MA-1.7 | onConfirm вызывается для опасных операций | ✅ |
| MA-1.8 | enableSummary сжимает историю при messages > 6 | ✅ |
| MA-1.9 | usage из API используется для подсчёта токенов | ✅ |
| MA-1.10 | initialMessages принимает готовый массив сообщений | ✅ |
| MA-1.11 | Инжект-сообщение (⚠️ system на позиции 1) удаляется после выполнения ask_user | ✅ |
| SK-3.2 | `SkillsLoader.loadSkillsSummary()` инжектится в system prompt воркера | planned |

## Связи

- **Использует:** `ChatAgentTools`, `ContextSummarizer`, `RoleAgentsMdLoader`, `SkillsLoader`
- **Используется:** `ChatViewProvider.runAgentLoop`, `AgentOrchestrator`
- **Модель:** `deepseek-v4-pro` (по умолчанию) или из `AgentRole.model`

## Детали реализации

- **Итерации:** max 5 в чате (runAgentLoop), 10 в headless (оркестратор)
- **initialMessages:** если передан — используется как есть; иначе строится system + task
- **Summary:** срабатывает при `enableSummary && i >= 2 && messages.length > 6`. Сжимаются все сообщения кроме system, task, и последних 2 пар. Результат вставляется как system-сообщение.
- **All tools merging:** `[...baseToolSchemas, ...extraTools]`, затем фильтр по `allowedTools`
- **Confirmation:** `onConfirm` получает `(toolName, args) → Promise<boolean>`. Если false — tool-сообщение с «Операция отклонена».
- **Токены:** приоритет `response.usage.prompt_tokens/completion_tokens`, fallback `chars/4`. Накопление за все итерации.
- **Ошибки:** throw Error — оркестратор ловит и изолирует; runAgentLoop ловит в handleSendMessage
- **Messages мутация:** ответы ассистента и tool-результаты пушатся в массив; при summary массив пересобирается
- **Очистка инжекта:** после выполнения `ask_user`, если сообщение на позиции 1 — system-роль с `⚠️` (инжект из ChatViewProvider), оно удаляется через `splice(1, 1)`. При следующем вызове `handleSendMessage` инжект создаётся заново — схема самовосстанавливающаяся.

## Промпты

### Системный (воркер)
```
{systemPrompt}

## Доступные инструменты:
{toolDescriptions}

Используй инструменты по одному за шаг. Отвечай кратко, по-русски.
```

### Summary
```
## Краткое содержание предыдущих шагов:
{summary}
```

## Тесты (agentWorker.test.ts, 10 тестов)

- MA-1.1: AgentWorker принимает AgentRole и создаёт изолированный контекст
- MA-1.2: Воркер использует свой systemPrompt, разные роли дают разные промпты
- MA-1.3: allowedTools фильтрует инструменты, без allowedTools — все доступны
- MA-1.4: Можно указать отдельную модель (AgentRole.model)
- MA-1.5: run() возвращает WorkerResult с ответом, шагами, токенами; fallback при исчерпании итераций
- Изоляция: два воркера с разными ролями работают независимо

## История изменений

| Версия | Дата | Изменения |
|--------|------|-----------|
| 0.9.0 | 2026-08-09 | Добавлен SkillsLoader: инжект скилов в system prompt воркера |
| 0.8.1 | 2026-08-08 | Очистка инжекта ⚠️ после выполнения ask_user (MA-1.11) |
| 0.8.0 | 2026-08-06 | Добавлены extraTools, onConfirm, enableSummary, initialMessages, usage API |
| 0.8.0 | 2026-08-07 | Исправлены тесты: конструктор { maxIterations }, мок usage, очистка тестового мусора |
| 0.7.0 | 2026-08-05 | Базовая реализация |
