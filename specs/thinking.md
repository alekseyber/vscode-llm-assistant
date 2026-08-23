---
component: thinking
version: 0.13.0
status: stable
since: 0.13.0
---

## Назначение

Управление режимом размышлений (thinking) для deepseek-моделей. DeepSeek V4 по умолчанию включает reasoning: модель тратит `maxTokens` на `reasoning_content`, а `content` (полезный ответ) остаётся пустым или коротким. Хелпер `buildThinkingExtraBody` формирует `extraBody` с `thinking: { type: 'disabled' }`.

## Интерфейс

### `buildThinkingExtraBody(model) → Record<string, any> | undefined`

Возвращает `{ thinking: { type: 'disabled' } }`, если модель — deepseek (`/deepseek/i`) и настройка `llmAssistant.disableThinking` включена. Иначе `undefined`.

## Контракты

| Ситуация | Поведение |
|----------|-----------|
| Модель не deepseek | `undefined` (параметр `thinking` не поддерживается) |
| `llmAssistant.disableThinking: false` (дефолт) | `undefined` |
| `disableThinking: true` + deepseek-модель | `{ thinking: { type: 'disabled' } }` |

## Связи

- **Используется:** ChatViewProvider, ChatPanel, EditController, AgentController (прокидывание `extraBody` в `provider.chat`)
- **Использует:** `CompletionOptions.extraBody` → `OpenAIProvider.chat()` (спред в тело запроса)
- **Конфигурация:** `llmAssistant.disableThinking`

## Детали реализации

- **Детект deepseek:** регулярка `/deepseek/i.test(model)` — параметр `thinking` поддерживают только deepseek-модели.
- **Автокомплит** отключает thinking всегда (мимо этой настройки, через `AutocompleteController`), остальные режимы — по `disableThinking`.
- **Прокидывание:** `extraBody` попадает в `CompletionOptions`, а `openai.ts` раскрывает его `...(options.extraBody ?? {})` в тело запроса к OpenAI SDK.

## История изменений

| Версия | Дата | Изменения |
|--------|------|-----------|
| 0.13.0 | 2026-08-23 | Базовая реализация (фикс пустого `content` у reasoning-моделей deepseek) |
