---
component: ChatViewProvider
version: 0.14.35
status: stable
since: 0.1.0
---

## Назначение

Главный WebView-хаб расширения. Обрабатывает все сообщения из чата: чат, агент, vision, @orchestrate. Делегирует AgentWorker для ReAct-цикла.

## Интерфейс

### `new ChatViewProvider(ctx, providerManager, conversationManager, runHistoryStore, historyViewProvider?, orchestratorViewProvider?, sessionLog?)`

### `resolveWebviewView(wv, ctx, token)` — точка входа WebView

### Обработчики сообщений

| Тип | Метод |
|-----|-------|
| `sendMessage` | `handleSendMessage(text, mode, provider?, model?)` |
| `cancelRequest` | `handleCancelRequest()` |
| `clearHistory` | `conversationManager.clearHistory()` |
| `clearAllSessions` | `commands.executeCommand('llmAssistant.clearAllSessions')` (модальный флоу) |
| `newSession` / `switchSession` / `deleteSession` / `renameSession` / `toggleFavorite` | Делегирование в `SessionManager` |

### `handleSendMessage(text, mode, provider?, model?)`

- Определяет провайдера и модель
- `@orchestrate` → `handleOrchestrate()`
- `/skill` → инжект скила из `.llma/skills/`
- слэш-команды (`/explain`, `/doc`, `/test`, `/review`, `/improve`, `/explain_stepbystep`) → инжект директивного system-промпта (см. `specs/SlashCommands.md`)
- `mode='agent'` → проверка `createWithTools` → `runAgentLoop()`
- `mode='chat'` → `provider.chat(stream)`
- Vision → `provider.chatWithVision()`

### `runAgentLoop(provider, model, messages)` → делегирует `AgentWorker.run()`

### `handleOrchestrate(taskText, provider, model)` → `AgentOrchestrator.execute()`

| `recordChatRun()` — запись в `RunHistoryStore` с `calculateCost()`

### `sendExternalPrompt(prompt: string)` ← **0.9.0**

Принимает внешний промпт (из Code Actions), отправляет в чат как агент.

| Вход | Тип | Описание |
|------|-----|----------|
| `prompt` | `string` | Текст промпта |

Действия: `postMessage({ type: 'externalPrompt', text })` → `handleSendMessage(prompt, 'agent')` → `commands.executeCommand('llmAssistant.chat.open')`.

## Контракты

| Ситуация | Поведение |
|----------|-----------|
| Отправка списка провайдеров в WebView | Модели берутся у провайдера (`provider.models()`); при ошибке/недоступном сервере — из `llmAssistant.providers.<name>.models` (fallback), рендер не блокируется |
| Локальный провайдер (`isLocal`) | В сообщение `providerList` попадает признак локальности; capabilities в селектор не входят (отдельный опциональный шаг) |


| Ситуация | Поведение |
|----------|-----------|
| Провайдер не поддерживает `createWithTools` | Ошибка «не поддерживает режим Агента» |
| `@orchestrate` вне агентного режима | Игнорируется |
| Vision + нет `supportsVision` | Ошибка |
| MCP-сервер недоступен | Лог в debugChannel, агент работает без MCP |
| Plan Mode ON + agent-режим | Ветвление в PlanModeManager.generatePlan() вместо runAgentLoop() |
| Plan Mode ON + chat-режим | Игнорируется — обычный чат |
| Контекст кода | `attachCodeContext` ДО `addMessage` |
| Внешний промпт (Code Actions) | `sendExternalPrompt` → agent-режим → фокус |
| Diagnostics перед agent loop | `DiagnosticsProvider.getDiagnosticsContext()` → в системный промпт |
| SkillsLoader: скилы в system prompt | `loadSkillsSummary()` → после AGENTS.md в getSystemPrompt() |
| Слэш-команда (`/explain`, `/doc`, ...) | Инжект `promptTemplate` на позицию 1, `text` = аргумент или `defaultTask` |

## Связи

- **Использует:** ProviderManager, ConversationManager, AgentWorker, AgentOrchestrator, McpClient, RunHistoryStore, DiagnosticsProvider, StatusBarIndicator, AgentsMdLoader, SkillsLoader, SlashCommands
- **Используется:** extension.ts (регистрация WebView)

## Детали реализации

- **WebView:** `enableScripts: true`, localResourceRoots — src/webviews/chat и node_modules
- **HTML:** index.html + styles.css + marked.min.js + main.js через `fs.readFileSync`
- **Auto-контекст:** активный редактор → `attachCodeContext()` ДО `addMessage()`
- **Vision:** `pendingImage`, одно сообщение `[{type:'text'},{type:'image_url'}]`
- **@orchestrate:** regex `/^@orchestrate\s+(.+)/`, только agent-режим
- **recordChatRun:** стоимость через `calculateCost()` с `providerManager.pricingMap`
- **abortController:** создаётся в handleSendMessage, проверяется в runAgentLoop
- **debugChannel:** `vscode.window.createOutputChannel('LLM Assistant')`
- **Инжект ask_user:** перед agent-режимом, если текст содержит триггер-слова (`спроси`, `уточни`, ...), в `messages` на позицию 1 вставляется system-сообщение с `⚠️`, принуждающее модель вызвать инструмент. AgentWorker удаляет этот инжект после выполнения `ask_user` (см. AgentWorker#Очистка инжекта). При следующем `handleSendMessage` инжект создаётся заново.
- **Слэш-команды:** `parseSlashCommand()` разбирает префикс `/<имя> [аргумент]`. Сначала `loadSkillMd()` (обратная совместимость `/skill`), затем `getSlashCommand()`. Промпт слэш-команды НЕ содержит `⚠️` — иначе AgentWorker удалит его при очистке инжекта (MA-1.11). Инжект на позицию 1, `text` = аргумент или `defaultTask`.
- **Принудительная запись (`writes: true`):** для `/doc` и `/test` в agent-режиме из промпта убирается инструкция «в chat-режиме выведи текст» (сбивает DeepSeek) и добавляется `⚠️`-директива «вызови write_file/replace_in_file СЕЙЧАС» — иначе модель отвечает текстом вместо function calling. Директива удаляется очисткой AgentWorker после первого вызова тула (штатно).
- **Диалог подтверждения (git-diff):** `requestConfirmation` для `write_file` читает текущее содержимое файла (`oldContent`) и передаёт в WebView; `showConfirmDialog` строит LCS-диф строк (context/remove/add) и выводит git-style: зелёные `+`, красные `−`, счётчик `+N −M`, контекстные строки без подсветки.
- **Ход выполнения (`toolActivity`):** вызовы тулов и их результаты (`onStep`, `onConfirm`) отправляются в WebView как структурированные `toolActivity`-сообщения (`{kind: 'start'|'result'|'note'}`). `start` несёт `toolName` + `args` (P0 Этап 3) — WebView рендерит дружелюбный шаг (`{icon} {label} {detail}` через `toolActivity.js`) вместо сырого `🔧 toolName`. Каждый тул — сворачиваемый `<details>` (статус `…`/`✓`, тело — результат), короткие результаты раскрываются сразу. Заметка (запрос подтверждения) — подсвеченная строка. По завершении (`done`) активность скрывается, в финальный ответ (`streamingRawText`) попадает только `result.answer`. При переключении/восстановлении сессии (`restoreHistory`) WebView сбрасывает стрим-состояние (`resetStreamingState`).
- **Сессионная маршрутизация + параллельные процессы:** `sendMessage`/`cancelRequest`/`implementPlan` передают `sessionId`. `postMessage(m, sessionId)` тегирует сообщение; WebView игнорирует сообщения с `sessionId !== currentSessionId` — результат остаётся в истории нужной сессии и появляется при переключении. `abortControllers: Map<sessionId, AbortController>` — каждый процесс отменяется независимо (`cancelRequest` с `sessionId`), что позволяет параллельные запуски в разных сессиях. `switchToSession(sessionId)` — публичный метод переключения активной сессии (вызывается из вкладки «История» по двойному клику).
- **История со старта + индикатор «в работе»:** запуск записывается в историю сразу (`recordRunStart`, статус `running`), по завершении обновляется (`finalizeRun` → `success`/`error`/`cancelled`). Охвачены все режимы: чат/агент (`handleSendMessage`), Plan Mode (`handlePlanMode`/`handleImplementPlan`), оркестратор (`handleOrchestrate`). В Plan Mode `handleSendMessage` НЕ записывает запуск (иначе двойная запись — `handlePlanMode` пишет свой). `broadcastRunState` шлёт WebView `runStarted`/`runEnded` (без тега `sessionId`, поле `runSessionId` — чтобы WebView получил независимо от активной сессии); WebView показывает индикатор ⏹️ «в работе» при возврате в сессию с активным процессом.
- **Сигнал отмены Plan Mode:** `handlePlanMode` получает `signal` напрямую параметром (`abortController.signal` из `handleSendMessage`), а не через `abortControllers.get(sessionId)` — исключает гонку, когда в одной сессии несколько параллельных запусков перезаписывают контроллер в Map (приводило к «Request was aborted»). `implementPlan` передаёт `sessionId` (кнопка «Имплементировать»).
- **Персистентность результата Plan Mode:** план (`handlePlanMode`), имплементация и рефлексия (`handleImplementPlan`) сохраняются в историю сессии через `addMessageTo` — иначе при переключении чата/восстановлении (`restoreHistory`) результат терялся. `planGenerated` несёт исходную `sessionId`; WebView хранит её в `plan-container.dataset.sessionId`, а кнопка «Имплементировать» шлёт эту исходную сессию (а не `sessionSelect.value`) — результат уходит в сессию, где был запущен план, даже после переключения чатов.
- **Автокомплит команд:** при `ready` (инициализация WebView) отправляет `{ type: 'slashCommands', items: [{name, description, kind, prefix}] }` — встроенные слэш-команды (`SLASH_COMMANDS`, `prefix: '/'`), скилы (`getSkillCatalog()`, `prefix: '/'`) и `@orchestrate` (`prefix: '@'`). WebView показывает попап автокомплита при вводе `/` или `@`.
- **Session-log (F1):** конструктор принимает опциональный `sessionLog`. В `runAgentLoop` в `AgentWorker` передаются `sessionId` + `onEvent: e => sessionLog.append(e)` (персист `tool/call`, `tool/result`, `assistant/message`). В стриминговых ветках (chat + vision) `logStreamChunk`/`finalizeStream` пишут `assistant/chunk` (троттлинг по ~200 симв.) и `assistant/message`. `logUserMessage` пишет `user/message` при добавлении пользовательского сообщения (chat + vision). `resolveSessionId` разрешает активную сессию при `sessionId === undefined`.
- **Копирование/экспорт сессии (F1):** кнопки «Копировать сессию в буфер» (`btn-share`) и «Экспорт в Markdown» (`btn-export`) шлют `getTranscript` (с `action: 'copy' | 'download'`) → ChatViewProvider отвечает `toTranscript()` → `sessionTranscript` → WebView копирует в clipboard или скачивает `.md`. Источник — session-log, не DOM (DOM-костыль `buildSessionText` удалён). `refreshSessionList()` — публичный метод обновления списка сессий + истории (вызывается из команды fork).
- **Тулбар ⋮ + «Удалить все» (P0, Этап 1):** WebView шлёт `clearAllSessions` → ChatViewProvider делегирует в команду `llmAssistant.clearAllSessions` через `executeCommand` (модальный флоу подтверждения уже там — без дублирования логики). Кнопки тулбара рендерятся из декларативного реестра `TOOLBAR_ACTIONS` (webview-ресурс `toolbar.js`), `getHtmlForWebview` инжектит его через `{{TOOLBAR}}`.
- **Сайдбар сессий + превью (P0, Этап 2):** `sendSessionListToWebview` обогащает каждую сессию полем `preview` (последнее `user/message`/`assistant/message` из session-log, до 80 символов, через `getSessionPreview`). `toggleFavorite` → `SessionManager.toggleFavorite(id)` → пересылка `sessionList`.
- **`reveal()` (0.13.0):** публичный метод показа/фокуса вкладки чата (`this.view?.show(true)`). `llmAssistant.chat.open` (`Ctrl+Alt+L`, на macOS `Cmd+Option+L`) вызывает его через `revealChat`-колбэк вместо создания легаси `ChatPanel` (которая помечена `@deprecated`).
- **Activity-feed (P0, Этап 3):** `getHtmlForWebview` инжектит `toolActivity.js` (`{{TOOLACTIVITY}}`) — маппинг `tool_name → {label, icon}`. `onStep` для `tool_call` пробрасывает `args` в `toolActivity.start`.
- **Оркестратор → session-log (F1 5a):** воркеры оркестратора создаются с `sessionId` + `onEvent: e => sessionLog.append(e)` (через workerOptions) — tool-события оркестратора пишутся в лог, экспорт/копия оркестратор-сессии стали полными (🔧-шаги). User-сообщение `@orchestrate` пишется в лог в **начале** оркестрации (до раннего return) — иначе список сообщений пуст при переключении чата.
- **Plan Mode → session-log (F1 5a, 0.12.1):** `handlePlanMode`/`handleImplementPlan` создают `PlanModeManager(workspacePath, resolveSessionId(sessionId), e => sessionLog.append(e))` — tool-события Plan Mode (PlannerAgent/оркестратор/ReviewerAgent/coderFixer) пишутся в лог, экспорт/копия plan-сессий полные.
- **restoreTokenIndicator:** при `ready`/`switchSession`/`switchToSession` индикатор 📊 подтягивает токены последнего запуска активной сессии из `RunHistoryStore` — решает «0+0 ≈ $0.0000 / 0/4096» у исходника после переключения/загрузки.
- **maxContextTokens в индикатор:** `getMaxContextTokens()` читает `llmAssistant.chat.maxContextTokens` (дефолт 4096) и шлёт `maxTokens` во все `tokens`-сообщения (postTokens/оркестратор/restore) — индикатор показывает реальный лимит, а не хардкод 4096.
- **limitExceeded → finalizeRun:** при воркере оркестратора без финального ответа запуск помечается статусом `limit_exceeded` (в истории «Лимит», не «Успех»); лимит итераций воркеров оркестратора 20 (было 10).
- **isAbortError:** отмена распознаётся через `isAbortError()` (AbortError + APIUserAbortError), применяется в catch-ветках чат/агент/оркестратор.

## AC

| ID | Критерий | Статус |
|----|----------|--------|
| CVP-6 | История и индикатор токенов используют расход от сервера (`onUsage`), оценка длина/4 — только при отсутствии данных | ✅ |
| CVP-1.1 | `sendProviderListToWebview()` берёт модели у провайдера (`models()`), при ошибке — из конфига; рендер не блокируется (сначала уходит конфиг, затем обновление) | ✅ |
| CVP-1.2 | В `providerList` есть признак локальности провайдера (`isLocal`) | ✅ |
| CVP-1.7 | Если картинка приложена, а модель без capability `vision` — показывается предупреждение `visionUnsupportedWarning()`, изображение не отправляется молча | ✅ |
| CVP-1.6 | `resolveVisionSupport()`: vision-ветка включается по `supportsVision` **или** по capability `vision` локального провайдера (`/api/show`), а не только по флагу в конфиге | ✅ |
| CVP-1.5 | `resolveModelForProvider()`: явный выбор приоритетен; пустой выбор + провайдер → первая модель провайдера, глобальный `defaultModel` — только последний fallback | ✅ |
| CVP-1.3 | Сообщение `tokens` несёт `cost`, посчитанный на бэкенде (`provider.isLocal` → 0); WebView не считает деньги сам | ✅ |

## Детали реализации (0.14.0)

- `sendProviderListToWebview()` перестаёт читать модели только из конфига: для каждого провайдера берётся `models()` (для `OllamaProvider` — `/api/tags` с кэшем 30 с), ошибка не пробрасывается наружу, используется конфиг.
- Вызов не блокирует отрисовку панели: сначала уходит список из конфига, затем — обновлённый после discovery.
- Иконки/capabilities в селекторе — не входят в 0.14.0 (опциональный AC P5-6.4 плана).
- Сборка сообщения из конфига вынесена в чистую функцию `buildProviderListFromConfig(providersConfig)` — её и проверяют тесты (`test/suite/chatViewProvider.test.ts`, suite `buildProviderListFromConfig`).
- Для локального провайдера после discovery вызывается `providerManager.setZeroPricing(models)`, чтобы найденные модели тоже не показывали выдуманную стоимость.

## Тесты

- `chatViewProvider.test.ts` — полный мок vscode/ProviderManager/LLM/AgentOrchestrator/PlanModeManager: `handleSendMessage` напрямую (chat/agent/planMode/orchestrate), сессионная маршрутизация, история со старта (`running` → `success`), отсутствие двойной записи в Plan Mode, ошибка агента без `createWithTools`, персистентность плана/имплементации/рефлексии (`handlePlanMode`/`handleImplementPlan` → `addMessageTo`).
- `chatWebview.test.ts` (jsdom) — DOM-харнесс WebView: маршрутизация по sessionId, git-diff диалог подтверждения (рендер + кнопка «Подтвердить»), автокомплит `/`, индикатор «в работе», треджинг исходной сессии `planGenerated` → кнопка «Имплементировать».
- AgentWorker тесты (runAgentLoop)
- ConversationManager тесты (история)
- Ручное тестирование (20-пунктовый чек-лист)

## История изменений

| Версия | Дата | Изменения |
|--------|------|-----------|
| 0.14.35 | 2026-11-10 | Бюджет по ревью: прогноз на агентский прогон = шаг × `agent.maxIterations`, резерв за сессией (`budgetReserved`) снимается в `finalizeRun` при любом статусе, модель после маршрутизации резолвится у провайдера, диалог превышения показывает лимит/потрачено/резерв/прогноз, предупреждение при неизвестной цене модели. AC `MR-11` |
| 0.14.34 | 2026-11-10 | P9: перед запросом — авто-выбор модели по сложности (`routing.*`, явный выбор пользователя не переопределяется), прогноз стоимости (`estimateRequestCost`), проверка лимита бюджета сессии (`budget.sessionLimitUsd`): при превышении вопрос с числами, отказ отменяет прогон до отправки; предупреждение на 80% — один раз на сессию. AC `MR-10` |
| 0.14.33 | 2026-11-10 | Тот же заголовок правил в `getSystemPrompt`: «## Правила проекта:» |
| 0.14.32 | 2026-11-10 | Замер прогона: счётчики инструментов обнуляются в начале `handleSendMessage`, в `finalizeRun` снимаются (`takeToolCallStats`), пишутся в debug-строку `[run] инструменты: …` и в поле `tools` записи истории | 
| 0.14.31 | 2026-11-09 | Предупреждение «Сообщение не влезло в контекст: отправлено N из M знаков» при обрезке текущего сообщения + debug-строка в канал. Раньше обрезка была молчаливой. AC `SLT-1` |
| 0.14.30 | 2026-11-09 | История и индикатор токенов берут расход от сервера (`options.onUsage`) в чате и vision-пути; оценка по символам — только если сервер ничего не вернул. AC `CVP-6` |
| 0.14.29 | 2026-11-09 | Выбор провайдера/модели в селекторе сообщается хосту сразу (`selectionChanged`) и запоминается в `globalState`. Раньше хост узнавал выбор только при отправке сообщения: в селекторе стояла локальная модель, а Edit уходил прежним облачным провайдером. Восстановление выбора при старте — для Edit после перезагрузки окна. Тест `SEL-1` |
| 0.14.28 | 2026-11-09 | E2E панели на живом NDJSON (`E2E-3`): протокол сообщение→стрим→`done`, `tokens` с `cost: 0`, запись прогона в историю и `assistant/chunk` в session-log, разовость предупреждения об обрезке, `cancelRequest`, сборка HTML без плейсхолдеров. RED: мутация ожидания валит `test-e2e` при зелёном `test-unit` |
| 0.14.27 | 2026-11-09 | Человеческое имя провайдера в списке: `providerDisplayTitle()` — явный `title` из конфига, иначе у локального суффикс «(локально)»; WebView рисует `title`, значение селектора остаётся ключом. AC `CVP-3.1`, тест `TIT-1` |
| 0.14.26 | 2026-11-09 | Список провайдеров помечает `isLocal` по адресу (`type: "ollama"` **или** loopback `baseUrl`): локальный OpenAI-совместимый движок (llama.cpp) получает тот же флаг в WebView и нулевые цены после discovery |
| 0.14.25 | 2026-11-08 | `chat.open` переведён на `Ctrl+Alt+L` / `Cmd+Option+L`: прежний `Ctrl+Shift+L` — дефолт VS Code «выделить все вхождения», глобальный биндинг его перекрывал |
| 0.14.14 | 2026-11-08 | Команда переименована в `llmAssistant.chat.open`: id `chat.focus` конфликтовал с авто-командой VS Code `<viewId>.focus` для view `llmAssistant.chat` — в палитре вместо «Открыть чат» показывалась «Focus on Чат View» |
| 0.14.13 | 2026-11-08 | `reveal()` посылает `focusInput`: команда «Открыть чат» ставит курсор в поле ввода (раньше только раскрывала панель); тест `CVP-1.8` |
| 0.14.12 | 2026-11-08 | Лимит шагов агента читается из `llmAssistant.agent.maxIterations` (в коде было зашито 5); сводка «Изменено файлов: N» в ответе |
| 0.13.0 | 2026-08-22 | P0 Этап 1: тулбар ⋮ + «Удалить все» — WebView шлёт `clearAllSessions` → `executeCommand('llmAssistant.clearAllSessions')`; `getHtmlForWebview` инжектит `toolbar.js` (`{{TOOLBAR}}`) |
| 0.13.0 | 2026-08-22 | P0 Этап 2: сайдбар сессий — `sessionList` с `preview` (getSessionPreview) + обработчик `toggleFavorite` |
| 0.13.0 | 2026-08-22 | P0 Этап 3: activity-feed — `toolActivity.start` несёт `args`, инжект `toolActivity.js` (`{{TOOLACTIVITY}}`) |
| 0.13.0 | 2026-08-22 | `reveal()` — chat.focus фокусирует сайдбар вместо легаси ChatPanel (@deprecated) |
| 0.13.0 | 2026-08-23 | Фикс подтверждения: `content` пробрасывает `args.command` (run_terminal не показывал команду в диалоге) |
| 0.13.0 | 2026-08-23 | `sendHistoryToWebview` → упорядоченные items (user/assistant+steps) из session-log — трейс шагов в истории |
| 0.13.0 | 2026-08-23 | Отмена персистится: `markCancelled` добавляет `_Запрос отменён._` в session-log (не исчезает при переключении сессий) |
| 0.13.0 | 2026-08-23 | `done` перед `reflectReport` — финализация стрима до показа отчёта («Имплементирую план…» не остаётся «в работе») |
| 0.12.1 | 2026-08-22 | Plan Mode → session-log: PlanModeManager получает sessionId + onEvent (tool-события planner/оркестратора/ревьюера в лог) |
| 0.12.0 | 2026-08-22 | isAbortError; user-msg оркестратора в лог сразу; restoreTokenIndicator; maxTokens в индикатор (getMaxContextTokens); limitExceeded → finalizeRun + maxIterations 20; onEvent+sessionId воркерам оркестратора (F1 5a) |
| 0.10.0 | 2026-08-20 | Фикс: результат Plan Mode персистится в сессию + кнопка «Имплементировать» шлёт исходную sessionId (не текущую) — результат не теряется при переключении чатов |
| 0.10.0 | 2026-08-20 | `computeLineDiff` (git-diff диалога) вынесен в `lineDiff.js` (инлайнится в index.html через `{{LINEDIFF}}`) |
| 0.10.0 | 2026-08-19 | Автокомплит команд: sendSlashCommandsToWebview (встроенные + скилы + @orchestrate, поле prefix) |
| 0.9.0 | 2026-08-18 | Слэш-команды код-действий: /explain, /explain_stepbystep, /doc, /test, /review, /improve (интеграция SlashCommands) |
| 0.14.5 | 2026-11-07 | Предупреждение при картинке на модели без vision (раньше изображение отбрасывалось молча); тест `CVP-1.7` |
| 0.14.4 | 2026-11-07 | Vision у локальных моделей определяется по capability `vision` (было: нужен ручной `supportsVision`, иначе `gemma3:4b` картинки не получал); 3 теста |
| 0.14.3 | 2026-11-07 | `resolveModelForProvider()` — модель не уезжает другому провайдеру; 3 теста |
| 0.14.2 | 2026-11-07 | Фикс по ручному прогону: `cost` в сообщении `tokens` считается на бэкенде; локальная модель показывает `$0.0000` (было «≈ $0.0005» из хардкод-таблицы WebView) |
| 0.14.1 | 2026-11-07 | Stage 3: реализован неблокирующий `providerList` (конфиг → discovery), `isLocal` в сообщении, `buildProviderListFromConfig`, обнуление цен после discovery; 3 теста |
| 0.14.0 | 2026-11-07 | `providerList`: модели от провайдера (`models()`) с fallback на конфиг, неблокирующий рендер |
| 0.9.0 | 2026-08-11 | Фикс: каталог скилов (getSkillTemplate) в getSystemPrompt() для agent-режима |
| 0.9.0 | 2026-08-11 | Фикс: Plan Mode сохраняет сообщение пользователя в историю |
| 0.9.0 | 2026-08-09 | SkillsLoader: инжект скилов в getSystemPrompt() |
| 0.9.0 | 2026-08-08 | Plan Mode: ветвление handleSendMessage → PlanModeManager, переключатель UI |
| 0.8.0 | 2026-08-06 | Делегирование в AgentWorker, loadOrchestratorRoles, MCP для оркестратора |
| 0.7.0 | 2026-08-05 | @orchestrate, RunHistoryStore |
| 0.11.3 | 2026-08-22 | F1 (SL-5): sessionLog — персист assistant/chunk (троттлинг) + assistant/message в стриминге; onEvent в AgentWorker |
| 0.11.3 | 2026-08-22 | F1 (Этап 2): logUserMessage — эмиссия user/message в session-log |
| 0.11.3 | 2026-08-22 | F1 (Этап 3): steps в RunHistoryStore из лога (computeStats) + фикс sessionId агент-режима |
| 0.11.3 | 2026-08-22 | F1 UI-хвост: getTranscript (copy/download) → toTranscript; кнопка export выровнена на лог; refreshSessionList для fork |
| 0.11.3 | 2026-08-22 | F1 5a: logUserMessage/finalizeStream убраны (addMessageTo пишет в лог); finalizeStream → flushChunkBuffer |
| 0.1.0 | 2026-08-04 | Базовая реализация |
