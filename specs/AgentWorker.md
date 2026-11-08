---
component: AgentWorker
version: 0.14.3
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
| `options.onEvent` | `callback` | События session-log (F1): `tool/call`, `tool/result`, `assistant/message` |
| `options.sessionId` | `string` | ID сессии для session-log (без него события не эмитятся) |

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
| `limitExceeded?` | `boolean` — воркер не дал финального ответа (исчерпан лимит итераций) |

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
| Исчерпан лимит итераций | `answer = 'Агент не дал финального ответа (исчерпан лимит итераций).'` + `limitExceeded: true` |
| После выполнения `ask_user` (если есть инжект ⚠️ на позиции 1) | Инжект удаляется из messages |
| LLM выбросил ошибку | Пробрасывается наверх (throw) |
| LLM выбросил `AbortError` / `APIUserAbortError` | Распознаётся через `isAbortError()` → отмена (не ошибка) |
| `onEvent` + `sessionId` заданы | Эмитит `tool/call`, `tool/result`, `assistant/message` |
| `onEvent` или `sessionId` не заданы | События не эмитятся (гард) |

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
| AW-1.1 | `createWithTools` вызывается с `buildThinkingExtraBody(model)` — рассуждение гасится в агентском цикле | ✅ |
| AW-1.2 | Локальный провайдер (`isLocal`) при `llmAssistant.local.toolLoop: false` (по умолчанию) не запускает инструменты, а отдаёт предупреждение с инструкцией, как включить | ✅ |
| AW-1.5 | Модель из `AgentWorkerOptions.model` приоритетнее `config.defaultModel` (иначе агент уходит на модель другого провайдера → 404) | ✅ |
| AW-1.4 | Стоимость прогона на локальном провайдере = 0 (иначе `calculateCost` без карты цен берёт DEFAULT_PRICING) | ✅ |
| AW-1.3 | Для `isLocal` применяется `llmAssistant.local.requestTimeout` (300 с), а не глобальные 60 с — таймаут живёт в `OllamaProvider` (Stage 2), воркер его не переопределяет | ✅ |

## Связи

- **Использует:** `ChatAgentTools`, `ContextSummarizer`, `RoleAgentsMdLoader`, `SkillsLoader`
- **Используется:** `ChatViewProvider.runAgentLoop`, `AgentOrchestrator`
- **Модель:** `deepseek-v4-pro` (по умолчанию) или из `AgentRole.model`

## Детали реализации

- **Итерации:** max 5 в чате (runAgentLoop), 20 в headless (оркестратор — лимит пробрасывается из ChatViewProvider через workerOptions); дефолт 10
- **initialMessages:** если передан — используется как есть; иначе строится system + task
- **Summary:** срабатывает при `enableSummary && i >= 2 && messages.length > 6`. Сжимаются все сообщения кроме system, task, и последних 2 пар. Результат вставляется как system-сообщение.
- **All tools merging:** `[...baseToolSchemas, ...extraTools]`, затем фильтр по `allowedTools`
- **Confirmation:** `onConfirm` получает `(toolName, args) → Promise<boolean>`. Если false — tool-сообщение с «Операция отклонена».
- **Step args (P0 Этап 3):** `AgentStep` для `tool_call` несёт `args` (распарсенные аргументы) — ChatViewProvider пробрасывает их в WebView для дружелюбного рендера шага (`{icon} {label} {detail}`) вместо сырого `🔧 toolName`.
- **Role в session-log (P0 Этап 5):** `emitEvent('tool/call'/'tool/result')` добавляет `role: this.role.name` — `toTranscript` группирует tool-шаги по воркерам (`### 01-{role}`).
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

## Детали реализации (0.14.0)

- **Прокидывание thinking:** вызов `this.provider.createWithTools(messages, model, toolSchemas, signal, undefined, buildThinkingExtraBody(model))` — шестой аргумент; без него deepseek-модель съедает бюджет на рассуждение и шаг возвращает пустой `content`.
- **Локальный провайдер:** проверка `this.provider.isLocal` (признак ставит `OllamaProvider`/`ProviderManager`). При `local.toolLoop === false` цикл не стартует: эмитится `error`-событие с текстом «локальная модель: агентский цикл выключен (`llmAssistant.local.toolLoop`)» и цикл завершается без вызовов инструментов.
- **Таймауты:** `local.requestTimeout` подставляется в опции запроса вместо глобального значения, только для `isLocal`.

## Тесты (agentWorker.test.ts, 12 тестов)

- MA-1.1: AgentWorker принимает AgentRole и создаёт изолированный контекст
- MA-1.2: Воркер использует свой systemPrompt, разные роли дают разные промпты
- MA-1.3: allowedTools фильтрует инструменты, без allowedTools — все доступны
- MA-1.4: Можно указать отдельную модель (AgentRole.model)
- MA-1.5: run() возвращает WorkerResult с ответом, шагами, токенами; fallback при исчерпании итераций
- limitExceeded: воркер без финального ответа возвращает `limitExceeded: true` + фолбэк-ответ
- Отмена: APIUserAbortError (name='Error') распознаётся через isAbortError как отмена
- Изоляция: два воркера с разными ролями работают независимо

## История изменений

| Версия | Дата | Изменения |
|--------|------|-----------|
| 0.14.3 | 2026-11-07 | `AgentWorkerOptions.model`: выбранная в панели модель доходит до воркера (было: `local` + `qwen3:8b` → запрос с моделью silicon → 404) |
| 0.14.2 | 2026-11-07 | Фикс по ручному прогону: `cost = 0` для `isLocal` (раньше локальный прогон считался по DEFAULT_PRICING) |
| 0.14.1 | 2026-11-07 | Stage 5: `buildThinkingExtraBody(model)` передаётся шестым аргументом; при `isLocal` и `local.toolLoop:false` цикл не стартует (ошибка + `run/final`), возврат `WorkerResult` с `iterations: 0`; 4 теста |
| 0.14.0 | 2026-11-07 | `extraBody` в `createWithTools` (гашение рассуждения), предупреждение при `local.toolLoop:false`, локальный профиль таймаутов |
| 0.13.0 | 2026-08-22 | P0 Этап 3: `args` в AgentStep (tool_call) для activity-feed в WebView |
| 0.13.0 | 2026-08-22 | P0 Этап 5: `role` в session-log tool-событиях (группировка по воркерам) |
| 0.12.0 | 2026-08-22 | WorkerResult.limitExceeded; isAbortError в catch ReAct-цикла |
| 0.9.0 | 2026-08-11 | signal и skipGlobalAllowList в AgentWorkerOptions; unfiltered-инструменты для обхода глобального allow-list |
| 0.9.0 | 2026-08-09 | Добавлен SkillsLoader: инжект скилов в system prompt воркера |
| 0.8.1 | 2026-08-08 | Очистка инжекта ⚠️ после выполнения ask_user (MA-1.11) |
| 0.11.3 | 2026-08-22 | onEvent + sessionId: эмиссия событий session-log (F1, SL-4) |
| 0.8.0 | 2026-08-06 | Добавлены extraTools, onConfirm, enableSummary, initialMessages, usage API |
| 0.8.0 | 2026-08-07 | Исправлены тесты: конструктор { maxIterations }, мок usage, очистка тестового мусора |
| 0.7.0 | 2026-08-05 | Базовая реализация |
