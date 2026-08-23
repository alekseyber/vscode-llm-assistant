---
component: ContextSummarizer
version: 0.4.0
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

## Детали реализации

- **Модель:** `chat.summaryModel` из конфига, fallback на `defaultModel`
- **Промпт:** «Сократи этот диалог до краткого содержания на русском языке. Сохрани ключевые решения, код и выводы.»
- **Вызов:** `provider.chatComplete()` (нестриминг), fallback на `provider.chat()`
- **Кеш:** Map<messageHash, summary>, инвалидация через `invalidateCache()`
- **Ошибки:** молча возвращает null


## Тесты (contextSummarizer.test.ts + summaryIntegration.test.ts, 12 тестов)

- AC-2.1: summarizeMessages() возвращает текст на русском; пустой массив → пусто
- AC-2.4: повторный вызов с теми же сообщениями — из кеша, без запроса
- AC-2.5: invalidateCache() сбрасывает кеш; addMessage инвалидирует
- AC-2.6: estimateTokens() — 1 токен ≈ 4 символа; summary не вызывается если обрезано < trigger
- AC-2.2: summary вставляется как второе system-сообщение
- AC-2.3: summaryEnabled=false — без summary
- fallback: summarizeMessages через chat() если chatComplete отсутствует

## История изменений

| Версия | Дата | Изменения |
|--------|------|-----------|
| 0.4.0 | 2026-08-05 | Базовая реализация |
