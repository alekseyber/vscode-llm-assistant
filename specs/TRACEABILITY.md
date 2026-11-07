---
document: TRACEABILITY
version: 0.14.0
---

# Матрица трассировки: spec → AC → тест → код

## Компоненты

| Spec | Исходник | Тесты | AC |
|------|----------|-------|----|
| AgentWorker | `src/modes/apply/AgentWorker.ts` | `test/suite/agentWorker.test.ts` | MA-1.1–MA-1.10 |
| AgentOrchestrator | `src/modes/apply/AgentOrchestrator.ts` | `test/suite/agentOrchestrator.test.ts` | MA-2.1–MA-2.6 |
| AgentSharedContext | `src/modes/apply/AgentSharedContext.ts` | `test/suite/agentCommunication.test.ts` | MA-3.1, MA-3.3 |
| AgentController | `src/modes/apply/AgentController.ts` | — | — |
| ToolSystem | `src/modes/apply/ToolSystem.ts` | `test/suite/tools.test.ts` | AC-9.5 |
| ToolDefinitions | `src/modes/apply/ToolDefinitions.ts` | — | — |
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
| OllamaProvider | `src/providers/ollama.ts` | `test/suite/ollamaProviderLocal.test.ts` | OLL-1.1–OLL-8.1 (все, кроме OLL-4.2 частично) |
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
| OLL-1.1 | `ollamaProviderLocal.test.ts` → «стримит content из NDJSON в правильном порядке» | ✅ |
| OLL-1.2 | `ollamaProviderLocal.test.ts` → «think:false по умолчанию, think:true при настройке» | ✅ |
| OLL-1.3 | `ollamaProviderLocal.test.ts` → «maxTokens → num_predict, local.numCtx → num_ctx» | ✅ |
| OLL-1.4 | `ollamaProviderLocal.test.ts` → «extraBody игнорируется и не попадает в тело» | ✅ |
| OLL-2.1 | `ollamaProviderLocal.test.ts` → «пустой content при непустом thinking…»; «в агентском шаге пустой content без tool_calls…» | ✅ |
| OLL-3.1 | `ollamaProviderLocal.test.ts` → «tool_calls в форме OpenAI, arguments — строка JSON, usage из eval_count» | ✅ |
| OLL-3.2 | `ollamaProviderLocal.test.ts` → «история агента конвертируется в нативный вид»; «конвертация — чистые функции, крайние случаи» | ✅ |
| OLL-4.1 | `ollamaProviderLocal.test.ts` → «/api/tags → список моделей, конфиг первым, кэш 30 с»; «сервер недоступен → модели из конфига» | ✅ |
| OLL-4.2 | `ollamaProviderLocal.test.ts` → «/api/show → capabilities, повторный вызов из кэша»; «/api/show упал → undefined»; «команда проверки…» (2 теста) | ✅ |
| OLL-5.1 | `ollamaProviderLocal.test.ts` → «image_url data-url → нативное images: [base64]»; «конвертер изображений — крайние случаи» | ✅ |
| OLL-6.1 | `ollamaProviderLocal.test.ts` → «404 model not found → подсказка ollama pull, без ретраев» | ✅ |
| OLL-6.2 | `ollamaProviderLocal.test.ts` → «сервер недоступен → ошибка соединения с подсказкой» | ✅ |
| OLL-6.3 | `ollamaProviderLocal.test.ts` → «отмена прерывает поток» | ✅ |
| OLL-6.4 / AW-1.3 | `ollamaProviderLocal.test.ts` → «local.requestTimeout ограничивает ожидание» | ✅ |
| OLL-7.1 | `providerManagerLocal.test.ts` → «type "ollama" создаёт OllamaProvider с isLocal» | ✅ |
| OLL-8.1 | `ollamaProviderLocal.test.ts` → «tool_calls в форме OpenAI… usage из eval_count» | ✅ |
| TH-1.1 | `thinking.test.ts` → «deepseek + disableThinking:true»; «disableThinking:false»; «не-deepseek модель» | ✅ |
| TH-1.2 | `thinking.test.ts` → «локальная модель не получает extraBody (гасится нативно)» | ✅ |
| TH-1.3 | `thinking.test.ts` → «shouldDisableThinking — таблица решений» | ✅ |
| TH-1.4 | `thinking.test.ts` → «для локального провайдера extraBody не формируется» | ✅ |
| AW-1.1 | `agentWorker.test.ts` → «buildThinkingExtraBody доходит до createWithTools шестым аргументом»; «без disableThinking extraBody не отправляется» | ✅ |
| AW-1.2 | `agentWorker.test.ts` → «локальный провайдер при toolLoop:false не вызывает инструменты»; «…toolLoop:true работает как обычно» | ✅ |
| OAI-1.1 | `providers.test.ts` → «extraBody уходит в тело запроса вместе с tools»; «без extraBody тело как в 0.13.0» | ✅ |
| CVP-1.1 | `chatViewProvider.test.ts` → «модели берутся из конфигурации…»; «пустая конфигурация не роняет сборку» | ✅ |
| CVP-1.2 | `chatViewProvider.test.ts` → «локальный провайдер помечен isLocal» | ✅ |

**Правки существующих тестов (запланированные, не регрессия):** `registerCommands.test.ts` — 11 команд → 12 (`checkLocalServer`).

## Статистика

- **Всего компонентов:** 27
- **С исходниками:** 27/27 (100%)
- **С тестами:** 19/27 (70%) — `OllamaProvider` и `ProviderManager` покрыты; `thinking.test.ts` появится в Stage 4
- **Без тестов:** AgentController, ToolDefinitions, ChatAgentTools, HistoryViewProvider, Logger, EditController, AutocompleteController, ChatPanel

## Правило обновления

При изменении любого `.ts` файла — обновляется соответствующая строка в этой матрице (версия, дата изменения).
