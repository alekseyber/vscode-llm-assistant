---
document: TRACEABILITY
version: 0.8.0
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
| ChatViewProvider | `src/modes/chat/ChatViewProvider.ts` | — | — |
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
| OpenAIProvider | `src/providers/openai.ts` | `test/suite/providers.test.ts` | AC-9.4 |
| ProviderManager | `src/providers/manager.ts` | `test/suite/providers.test.ts` | AC-9.4 |
| Streaming | `src/shared/streaming.ts` | `test/suite/streaming.test.ts` | AC-9.3 |
| Logger | `src/shared/logger.ts` | — | — |
| EditController | `src/modes/edit/EditController.ts` | — | — |
| AutocompleteController | `src/modes/autocomplete/AutocompleteController.ts` | — | — |

## Статистика

- **Всего компонентов:** 26
- **С исходниками:** 26/26 (100%)
- **С тестами:** 17/26 (65%)
- **Без тестов:** AgentController, ToolDefinitions, ChatViewProvider, ChatAgentTools, HistoryViewProvider, Logger, EditController, AutocompleteController, ChatPanel

## Правило обновления

При изменении любого `.ts` файла — обновляется соответствующая строка в этой матрице (версия, дата изменения).
