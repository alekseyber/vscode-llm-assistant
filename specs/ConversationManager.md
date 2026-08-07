---
component: ConversationManager
version: 0.8.0
status: stable
since: 0.1.0
---

## Назначение

Управление историей сообщений чата. Делегирует хранение в `SessionManager`, добавляет логику контекста (учёт токенов) и summary (сжатие при переполнении).

## Интерфейс

### `new ConversationManager(storage: Memento)`

### `getMessages() → ContextMessage[]`

### `getMessagesForRequest(provider?) → ChatMessage[]`

Собирает: system prompt + AGENTS.md + [summary] + история с учётом лимита токенов.

### `addMessage(message)`

Добавляет сообщение, применяет pendingContext, авто-имя сессии.

### `clearHistory()` / `attachCodeContext(context)`

### `estimateTokens(text) → number` — chars/4

## Контракты

| Ситуация | Поведение |
|----------|-----------|
| История > maxContextTokens | Обрезается с конца (новые остаются) |
| Обрезано ≥ summaryTriggerTokens (256) | Вызывается ContextSummarizer |
| summaryEnabled = false | Без сжатия |
| pendingContext задан | Прикрепляется к следующему user-сообщению |
| MAX_MESSAGES (100) | Старые вытесняются в SessionManager |

## Связи

- **Использует:** SessionManager, ContextSummarizer, AgentsMdLoader
- **Используется:** ChatViewProvider

## История изменений

| Версия | Дата | Изменения |
|--------|------|-----------|
| 0.1.0 | 2026-08-04 | Базовая реализация |
