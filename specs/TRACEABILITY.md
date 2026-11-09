---
document: TRACEABILITY
version: 0.14.29
---

# Матрица трассировки: spec → AC → тест → код

## Компоненты

| Spec | Исходник | Тесты | AC |
|------|----------|-------|----|
| AgentWorker | `src/modes/apply/AgentWorker.ts` | `test/suite/agentWorker.test.ts` | MA-1.1–MA-1.10 |
| AgentOrchestrator | `src/modes/apply/AgentOrchestrator.ts` | `test/suite/agentOrchestrator.test.ts` | MA-2.1–MA-2.6 |
| AgentSharedContext | `src/modes/apply/AgentSharedContext.ts` | `test/suite/agentCommunication.test.ts` | MA-3.1, MA-3.3 |
| AgentController | `src/modes/apply/AgentController.ts` | `test/suite/agentController.test.ts` | CNF-1–CNF-3 |
| ToolSystem | `src/modes/apply/ToolSystem.ts` | `test/suite/tools.test.ts` | AC-9.5 |
| ToolDefinitions | `src/modes/apply/ToolDefinitions.ts` | `test/suite/writeFileIdempotent.test.ts` | WF-1–WF-3 |
| ToolAllowList | `src/modes/apply/ToolAllowList.ts` | `test/suite/toolAllowList.test.ts` | AC-4.1–AC-4.4 |
| McpClient | `src/modes/apply/McpClient.ts` | `test/suite/mcpClient.test.ts` | AC-5.1–AC-5.5 |
| ChatViewProvider | `src/modes/chat/ChatViewProvider.ts` | `test/suite/chatWebview.test.ts` | CVP-1.1 (planned) |
| ConversationManager | `src/modes/chat/ConversationManager.ts` | `test/suite/conversation.test.ts` | — |
| SessionManager | `src/modes/chat/SessionManager.ts` | `test/suite/session.test.ts` | — |
| ChatAgentTools | `src/modes/chat/ChatAgentTools.ts` | — | AC-4.1–AC-4.4 |
| ContextSummarizer | `src/shared/ContextSummarizer.ts` | `test/suite/contextSummarizer.test.ts`, `test/suite/summaryIntegration.test.ts` | AC-2.1–AC-2.6 |
| RetryHandler | `src/shared/RetryHandler.ts` | `test/suite/retryHandler.test.ts` | AC-3.1–AC-3.7 |
| AgentsMdLoader | `src/shared/AgentsMdLoader.ts` | `test/suite/agentsMd.test.ts` | AC-1.1–AC-1.6 |
| RoleAgentsMdLoader | `src/shared/RoleAgentsMdLoader.ts` | `test/suite/roleAgentsMd.test.ts` | MA-5.1–MA-5.2 |
| SkillsLoader | `src/shared/SkillsLoader.ts` | `test/suite/skillsLoader.test.ts` | SK-1.1–SK-3.4 |
| RunHistoryStore | `src/shared/RunHistoryStore.ts` | `test/suite/runHistoryStore.test.ts` | AC-6.6 |
| HistoryViewProvider | `src/modes/history/HistoryViewProvider.ts` | — | — |
| OrchestratorViewProvider | `src/modes/orchestrator/OrchestratorViewProvider.ts` | `test/suite/orchestratorView.test.ts` | MA-4.1–MA-4.5 |
| OpenAIProvider | `src/providers/openai.ts` | `test/suite/providers.test.ts` | AC-9.4, OAI-1.1 |
| OllamaProvider | `src/providers/ollama.ts` | `test/suite/ollamaProviderLocal.test.ts`, `test/suite/contextGuard.test.ts`, `test/suite/ollamaConnectTimeout.test.ts` | OLL-1.1–OLL-10.4 (все, кроме OLL-4.2 частично) |
| thinking | `src/shared/thinking.ts` | `test/suite/thinking.test.ts` | TH-1.1–TH-1.4 |
| ProviderManager | `src/providers/manager.ts` | `test/suite/providers.test.ts`, `test/suite/providerManagerLocal.test.ts` | AC-9.4, PRM-1.1–PRM-1.5 |
| Streaming | `src/shared/streaming.ts` | `test/suite/streaming.test.ts` | AC-9.3 |
| Logger | `src/shared/logger.ts` | — | — |
| EditController | `src/modes/edit/EditController.ts` | — | — |
| AutocompleteController | `src/modes/autocomplete/AutocompleteController.ts` | решение вынесено в `thinking.test.ts` (TH-1.4) | AC-AC-1, AC-AC-2 |


## Матрица 0.14.0 (P5 — локальные модели): AC → тест

Заполняется по факту (Stage 6). Базлайн до работ: **449 passing / 0 failing** (`npm run test:mocked`, 2026-11-07). После работ: **492 passing / 0 failing**.

| AC | Файл теста → имя | Статус |
|----|------------------|--------|
| PRM-1.1 | `providerManagerLocal.test.ts` → «type "ollama" создаёт OllamaProvider с isLocal»; «локальный провайдер не требует apiKey» | ✅ |
| PRM-1.2 | `providerManagerLocal.test.ts` → «конфиг без type → OpenAIProvider (обратная совместимость)» | ✅ |
| PRM-1.3 | `providerManagerLocal.test.ts` → «type описан в конфиге; отсутствие baseUrl даёт адрес по умолчанию» | ✅ |
| PRM-1.4 | `providerManagerLocal.test.ts` → «локальные модели стоят 0…»; «setZeroPricing обнуляет модели из discovery» | ✅ |
| PRM-1.5 | `providerManagerLocal.test.ts` → «неизвестный type пропускает провайдера, остальные создаются» | ✅ |
| PRM-1.6 | `providerManagerLocal.test.ts` → «нули переживают refresh() после правки настроек» (дефект «768+40 = 0.0004» из ручного прогона) | ✅ |
| OLL-1.1 | `ollamaProviderLocal.test.ts` → «стримит content из NDJSON в правильном порядке» | ✅ |
| OLL-1.2 | `ollamaProviderLocal.test.ts` → «think:false по умолчанию, think:true при настройке» | ✅ |
| OLL-1.3 | `ollamaProviderLocal.test.ts` → «maxTokens → num_predict, local.numCtx → num_ctx» | ✅ |
| OLL-1.4 | `ollamaProviderLocal.test.ts` → «extraBody игнорируется и не попадает в тело» | ✅ |
| OLL-2.1 | `ollamaProviderLocal.test.ts` → «пустой content при непустом thinking…»; «в агентском шаге пустой content без tool_calls…» | ✅ |
| OLL-3.1 | `ollamaProviderLocal.test.ts` → «tool_calls в форме OpenAI, arguments — строка JSON, usage из eval_count» | ✅ |
| OLL-3.2 | `ollamaProviderLocal.test.ts` → «история агента конвертируется в нативный вид»; «конвертация — чистые функции, крайние случаи» | ✅ |
| OLL-4.1 | `ollamaProviderLocal.test.ts` → «/api/tags → список моделей, конфиг первым, кэш 30 с»; «сервер недоступен → модели из конфига»; «эмбеддинг-модели не попадают в чат-селектор»; «пустые capabilities / недоступный /api/show — модель не выбрасываем» | ✅ |
| OLL-4.2 | `ollamaProviderLocal.test.ts` → «/api/show → capabilities, повторный вызов из кэша»; «/api/show упал → undefined»; «команда проверки…» (2 теста) | ✅ |
| OLL-5.1 | `ollamaProviderLocal.test.ts` → «image_url data-url → нативное images: [base64]»; «конвертер изображений — крайние случаи» | ✅ |
| OLL-6.1 | `ollamaProviderLocal.test.ts` → «404 model not found → подсказка ollama pull, без ретраев» | ✅ |
| OLL-6.2 | `ollamaProviderLocal.test.ts` → «сервер недоступен → ошибка соединения с подсказкой» | ✅ |
| OLL-6.3 | `ollamaProviderLocal.test.ts` → «отмена прерывает поток» | ✅ |
| OLL-6.4 / AW-1.3 | `ollamaProviderLocal.test.ts` → «local.requestTimeout ограничивает ожидание» | ✅ |
| OLL-7.1 | `providerManagerLocal.test.ts` → «type "ollama" создаёт OllamaProvider с isLocal» | ✅ |
| OLL-8.1 | `ollamaProviderLocal.test.ts` → «tool_calls в форме OpenAI… usage из eval_count» | ✅ |
| OLL-9.1 | `ollamaProviderLocal.test.ts` → «prompt_eval_count == num_ctx → предупреждение об обрезке» | ✅ |
| OLL-9.2 | `ollamaProviderLocal.test.ts` → «prompt_eval_count заметно меньше окна → предупреждения нет» | ✅ |
| OLL-9.3 | `ollamaProviderLocal.test.ts` → «предупреждение один раз на модель, другая модель — предупреждает» | ✅ |
| OLL-9.4 | `ollamaProviderLocal.test.ts` → «debug-строка с фактическим prompt_eval_count пишется на каждый ответ» | ✅ |
| CG-1..3 | `contextGuard.test.ts` → «граница включительно…», «нет данных о токенах — null», «текст называет оба числа и обе ручки» | ✅ |
| OLL-10.1..10.4 | `ollamaConnectTimeout.test.ts` → «сервер принял соединение и молчит…», «заголовки пришли — медленная генерация не рвётся», «провайдер отдаёт CONNECT_TIMEOUT быстро и не ретраит», «отмена не маскируется под таймаут» | ✅ |
| OVL-1..3 | `localOverrides.test.ts` → «override побеждает глобальную настройку», «без override берётся глобальная», «невалидный override игнорируется» | ✅ |
| PRM-2.1..2.3 | `providerManagerLocal.test.ts` → «type openai на loopback — isLocal и нулевая цена (llama.cpp)», «облачный адрес остаётся платным», «toolLoop из записи провайдера» | ✅ |
| LZ-1..3 | `localAddress.test.ts` → «loopback в любых формах — локальный», «облачные и неоднозначные адреса — не локальные», «путь и query не влияют на вердикт» | ✅ |
| PRM-3.2 | `providerManagerLocal.test.ts` → «numCtx у локального openai-провайдера → предупреждение один раз» | ✅ |
| CVP-3.1 / TIT-1 | `chatViewProvider.test.ts` → «человеческое имя — title побеждает, локальный без title получает «(локально)»»; `chatWebview.test.ts` → «в селекторе видно человеческое имя провайдера» | ✅ |
| E2E-1 | `e2e/localEngines.e2e.ts` → «настройки из настоящего settings.json доходят до провайдеров и до numCtx» (Extension Host) | ✅ |
| E2E-2 | `e2e/localEngines.e2e.ts` → «запрос к живому HTTP-серверу из хост-процесса и предупреждение не ломают прогон» | ✅ |
| E2E-4a/b/c | `e2e/confirmGate.e2e.ts` → «отказ и второй отказ останавливают прогон», «согласие записывает файл и сводку», «`toolLoop=false` не вызывает инструменты» | ✅ |
| Контекст → текущее сообщение не выбрасывается | `SLT-1` (`sessionLog.test.ts`) → «обрезается, а не выбрасывается» | ✅ |
| Токены → Ollama отдаёт расход | `OLL-12.1/12.2` (`ollamaProviderLocal.test.ts`) | ✅ |
| Токены → локальный openai-движок отдаёт usage | `OAI-4.1/4.2` (`usageTokens.test.ts`) | ✅ |
| Токены → чат пишет в историю расход сервера | `CVP-6` (`chatViewProvider.test.ts`) | ✅ |
| Токены → Edit пишет в историю расход сервера | `ECD-2` (`editController.test.ts`) | ✅ |
| Edit → стоимость локального прогона | `ECD-1` (`editController.test.ts`) → «локальная модель в Edit-истории даёт стоимость 0» | ✅ |
| Edit → выбор в селекторе | `SEL-1` (`chatViewProvider.test.ts`) → «смена провайдера в селекторе запоминается сразу» | ✅ |
| Edit → ошибки провайдера | `EER-1..3` (`editController.test.ts`) → «429 называет провайдера, модель и что делать» и др. | ✅ |
| Edit → линзы после медленного ответа | `EDT-3` (`editController.test.ts`) → «после открытия diff линзы запрашиваются заново» | ✅ |
| Edit → прерывание | `EDT-1/2` (`editController.test.ts`) → «новая правка закрывает прошлое предложение», «закрытие вкладки руками снимает сессию» | ✅ |
| Edit → провайдер | `EDI-1` (`editController.test.ts`) → «Edit идёт в выбранного в панели провайдера, а не в defaultProvider» | ✅ |
| Edit → История | `RHS-1/2` (`runHistoryStore.test.ts`) → «запись, обновление и очистка дёргают onDidChange», «Edit-прогон тоже поднимает событие» | ✅ |
| E2E-6a..d | `e2e/workspaceContext.e2e.ts` → «правила роли в промпте», «каталог скилов и его удаление», «allow-list режет tools[]», «fallback main.md» | ✅ |
| E2E-7 | `e2e/providerLifecycle.e2e.ts` → «правка settings → refresh: новый провайдер с подписью, цена 0, удаление убирает из списка» | ✅ |
| E2E-3a..d | `e2e/chatPanel.e2e.ts` → «сообщение панели → склейка стрима, done, tokens cost 0, история и лог», «предупреждение один раз», «cancelRequest останавливает поток», «HTML без плейсхолдеров» | ✅ |
| E2E-8a/b/c | `e2e/timeouts.e2e.ts` → «чёрная дыра + requestTimeout=2», «закрытый порт → ECONNREFUSED с подсказкой», «сервер поднялся на том же порту» | ✅ |
| E2E-9a/b/c | `e2e/discovery.e2e.ts` → «модели из /api/tags, embedding отфильтрован», «checkLocalServer отдаёт отчёт», «сервер погашен — не падает» | ✅ |
| OAI-3.1..3.4 | `openaiDiscovery.test.ts` → «модели из /v1/models, конфиг первым», «ошибка/недоступен → конфиг», «облачный не ходит в /v1/models», «кэш 30 с» | ✅ |
| OAI-2.1/2.2 | `providerErrors.test.ts` → «локальный движок — подсказка про намеренный запуск», «облачный провайдер — нейтральный текст, HTTP-ошибки не оборачиваются» | ✅ |
| TH-1.1 | `thinking.test.ts` → «deepseek + disableThinking:true»; «disableThinking:false»; «не-deepseek модель» | ✅ |
| TH-1.2 | `thinking.test.ts` → «локальная модель не получает extraBody (гасится нативно)» | ✅ |
| TH-1.3 | `thinking.test.ts` → «shouldDisableThinking — таблица решений» | ✅ |
| TH-1.4 | `thinking.test.ts` → «для локального провайдера extraBody не формируется» | ✅ |
| AW-1.1 | `agentWorker.test.ts` → «buildThinkingExtraBody доходит до createWithTools шестым аргументом»; «без disableThinking extraBody не отправляется» | ✅ |
| AW-1.2 | `agentWorker.test.ts` → «локальный провайдер при toolLoop:false не вызывает инструменты»; «…toolLoop:true работает как обычно» | ✅ |
| AW-1.4 | `agentWorker.test.ts` → «прогон на локальном провайдере стоит 0, а не DEFAULT_PRICING» | ✅ |
| OAI-1.1 | `providers.test.ts` → «extraBody уходит в тело запроса вместе с tools»; «без extraBody тело как в 0.13.0» | ✅ |
| CVP-1.1 | `chatViewProvider.test.ts` → «модели берутся из конфигурации…»; «пустая конфигурация не роняет сборку» | ✅ |
| CVP-1.2 | `chatViewProvider.test.ts` → «локальный провайдер помечен isLocal» | ✅ |

**Правки существующих тестов (запланированные, не регрессия):** `registerCommands.test.ts` — 11 команд → 12 (`checkLocalServer`); `ollamaProviderLocal.test.ts` — ожидание `capabilities()` расширено полями `completion`/`embedding`.

**Найдено ручным прогоном 0.14.0 (Stage 8) и закрыто тестами:** стоимость локальной модели `0.0004` вместо `0` (PRM-1.6, AW-1.4); эмбеддинг-модель в чат-селекторе (OLL-4.1). Текущий итог: **497 passing / 0 failing**.

## Статистика

- **Всего компонентов:** 27
- **С исходниками:** 27/27 (100%)
- **С тестами:** 19/27 (70%) — `OllamaProvider` и `ProviderManager` покрыты; `thinking.test.ts` появится в Stage 4
- **Без тестов:** AgentController, ToolDefinitions, ChatAgentTools, HistoryViewProvider, Logger, EditController, AutocompleteController, ChatPanel

## Правило обновления

При изменении любого `.ts` файла — обновляется соответствующая строка в этой матрице (версия, дата изменения).

| RunSummary | `src/shared/runSummary.ts` | `test/suite/runSummary.test.ts` | SUM-1–SUM-6 |
| PromptGuard | `src/shared/promptGuard.ts` | `test/suite/promptGuard.test.ts` | PG-1–PG-7 |
| RunStats | `src/shared/runStats.ts` | `test/suite/runStats.test.ts` | RS-1–RS-5 |
