---
component: Streaming
version: 0.8.0
status: stable
since: 0.1.0
---

## Назначение

SSE-парсинг для стриминговых ответов LLM. Разбирает `data: {...}\n\n` чанки, извлекает `delta.content`.

## Интерфейс

### `parseSSE(text) → ParsedEvent[]`

Разбирает многострочный SSE-поток в массив событий.

### `isStreamDone(event) → boolean`

Проверяет сигнал завершения `[DONE]`.

### `extractDeltaContent(chunk) → string | null`

Извлекает `choices[0].delta.content` из JSON-чанка.

### `parseChatCompletionStream(text) → string[]`

Полный SSE → массив токенов.

### `createMockStream(chunks, signal?) → AsyncIterable<string>`

Создаёт мок-стрим для тестов.

## Контракты

| Ситуация | Поведение |
|----------|-----------|
| Пустой ввод | `parseSSE` → [] |
| Комментарии (`: ...`) | Игнорируются |
| `event:` поле | Сохраняется |
| Невалидный JSON | Пропускается |
| `[DONE]` | Сигнал завершения |
| AbortSignal | Стрим прерывается |

## Связи

- **Используется:** OpenAIProvider (парсинг ответов)
- **Тесты:** `test/suite/streaming.test.ts`

## История изменений

| Версия | Дата | Изменения |
|--------|------|-----------|
| 0.1.0 | 2026-08-04 | Базовая реализация |
