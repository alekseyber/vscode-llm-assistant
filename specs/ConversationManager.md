---
component: ConversationManager
version: 0.8.0
status: stable
since: 0.1.0
---

## Назначение

Управление историей сообщений чата. Делегирует хранение в `SessionManager`, добавляет логику контекста (учёт токенов) и summary (сжатие при переполнении).

## Интерфейс

### `new ConversationManager(storage: Memento, sessionLog?: SessionLog)` — sessionLog (F1): если задан, addMessageTo/getMessages/getMessagesForRequest работают с логом

### `getMessages() → ContextMessage[]`

### `getMessagesForRequest(provider?) → ChatMessage[]`

Собирает: system prompt + AGENTS.md + [summary] + история с учётом лимита токенов.

### `addMessage(message)`

Добавляет сообщение, применяет pendingContext, авто-имя сессии.

### `addMessageTo(sessionId, message)`

Записывает в конкретную сессию (не обязательно активную). `sessionId = undefined` → активная (обратная совместимость).

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
| `addMessageTo(неактивная сессия)` | Пишет в указанную сессию, активная не меняется |

## Связи

- **Использует:** SessionManager, ContextSummarizer, AgentsMdLoader
- **Используется:** ChatViewProvider

## Детали реализации

- **Оценка токенов:** `chars.length / 4`
- **Учёт контекста:** `pendingContext` прикрепляется к user-сообщению при `addMessage()`. Контекст форматируется: `--- Файл: {path} --- \`\`\`\n{content}\n\`\`\``
- **Порядок:** `attachCodeContext()` должен вызываться ДО `addMessage()` — иначе контекст прикрепится к следующему сообщению
- **Обрезка истории:** с конца (новые остаются). Сообщения без контекста кода идут в trimmed (для summary)
- **MAX_MESSAGES:** 100 в SessionManager
- **Инвалидация кеша:** при каждом `addMessage()` сбрасывается `summarizer.invalidateCache()`

## Форматы данных

### System prompt
```
{systemPrompt}

## Правила проекта (AGENTS.md):
{agentsMd}
```

## Тесты (conversation.test.ts, 14 тестов)

- addMessage() добавляет сообщение, вызывает save()
- addMessageTo() пишет в конкретную сессию, а не в активную
- addMessageTo(undefined) падает на активную сессию
- getMessages() возвращает копию массива
- clearHistory() очищает, вызывает save()
- attachCodeContext() добавляет контекст к следующему user-сообщению (не к assistant)
- getMessagesForRequest() возвращает system + сообщения, учитывает контекст кода в токенах
- Конструктор загружает сохранённые сессии; начинает с одной если нет данных
- MAX_MESSAGES: ограничение 100

## История изменений

| Версия | Дата | Изменения |
|--------|------|-----------|
| 0.1.0 | 2026-08-04 | Базовая реализация |
| 0.11.3 | 2026-08-22 | F1 5a/5b/5c/5d: sessionLog-инъекция; addMessageTo → лог; getMessagesForRequest → deriveMessagesWithTrimmed; getMessages → deriveMessages (fallback на SessionManager) |
