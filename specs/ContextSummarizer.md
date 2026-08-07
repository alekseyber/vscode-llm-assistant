---
component: ContextSummarizer
version: 0.8.0
status: stable
since: 0.4.0
---

## Назначение

Сжатие истории сообщений в краткое summary через LLM. Используется в ConversationManager (при переполнении контекста) и AgentWorker (при длинных цепочках инструментов).

## Интерфейс

### `summarizeMessages(messages, provider, model) → Promise<string | null>`

Отправляет сообщения в LLM через `provider.chatComplete()`, получает summary на русском.

### `invalidateCache()`

Сбрасывает кеш (при добавлении новых сообщений).

## Контракты

| Ситуация | Поведение |
|----------|-----------|
| Пустой массив | Возвращает пустую строку |
| Те же сообщения повторно | Из кеша, без запроса в LLM |
| Кеш инвалидирован | Новый запрос в LLM |
| chatComplete отсутствует | Fallback на provider.chat() |
| Ошибка LLM | Молча возвращает null |

## Связи

- **Используется:** ConversationManager, AgentWorker, AgentController
- **Зависит от:** LLM-провайдер (chatComplete или chat)

## История изменений

| Версия | Дата | Изменения |
|--------|------|-----------|
| 0.4.0 | 2026-08-05 | Базовая реализация |
