---
component: thinking
version: 0.14.1
status: stable
since: 0.13.0
---

## Назначение

Управление режимом размышлений на **двух разных механизмах**, которые нельзя подменять друг другом:

1. **Облачные reasoning-модели deepseek** — параметр `thinking: { type: 'disabled' }` в теле OpenAI-запроса (`buildThinkingExtraBody`). DeepSeek V4 по умолчанию включает reasoning и тратит `maxTokens` на `reasoning_content`, оставляя `content` пустым.
2. **Локальные модели Ollama** — нативный флаг `think` у `/api/chat`. Через OpenAI-совместимый `/v1` рассуждение **не отключается ничем** (проверено: `think:false` в теле и `chat_template_kwargs.enable_thinking:false` игнорируются, `content` пуст). Поэтому локальный путь вообще не использует `extraBody` — флаг ставит `OllamaProvider` из `llmAssistant.local.think` (по умолчанию `false`).

Решение «надо ли гасить рассуждение» вынесено в чистую функцию, чтобы её можно было покрыть юнит-тестом: отдельного теста на `AutocompleteController` в репозитории нет.

## Интерфейс

### `buildThinkingExtraBody(model) → Record<string, any> | undefined`

Возвращает `{ thinking: { type: 'disabled' } }`, если модель — deepseek (`/deepseek/i`) и настройка `llmAssistant.disableThinking` включена. Иначе `undefined`. Для локальных моделей **не применяется** — их гасит `OllamaProvider` нативно.

### `shouldDisableThinking({ model, isLocal, disableThinking, always? }) → boolean`

Чистая функция без обращений к `vscode` (тестируется напрямую):

| Вход | Результат |
|------|-----------|
| `isLocal: true` | `true` — нативный провайдер ставит `think:false` сам, `extraBody` не нужен |
| `always: true` + deepseek | `true` — режим автокомплита (у deepseek thinking выключается всегда) |
| `disableThinking: true` + deepseek | `true` |
| иначе | `false` |

## Контракты

| Ситуация | Поведение |
|----------|-----------|
| Модель не deepseek | `undefined` (параметр `thinking` не поддерживается) |
| `llmAssistant.disableThinking: false` (дефолт) | `undefined` |
| `disableThinking: true` + deepseek-модель | `{ thinking: { type: 'disabled' } }` |
| Локальная модель (`isLocal: true`) | `buildThinkingExtraBody` → `undefined`; рассуждение гасится флагом `think` в `OllamaProvider` |
| `extraBody` пришёл в `OllamaProvider` | Игнорируется (нативный API не принимает `thinking`) |
| `shouldDisableThinking` для локальной модели | `true` — но это означает «провайдер поставит `think:false`», а не «добавить `extraBody`» |

## AC

| ID | Критерий | Статус |
|----|----------|--------|
| TH-1.1 | `buildThinkingExtraBody` для deepseek + `disableThinking: true` → `{thinking:{type:'disabled'}}`; для не-deepseek → `undefined` | ✅ |
| TH-1.2 | `buildThinkingExtraBody` не применяется к локальным моделям (`OllamaProvider` гасит нативно) | ✅ |
| TH-1.3 | `shouldDisableThinking` — чистая функция: `isLocal` → `true`; `always` + deepseek → `true`; иначе по `disableThinking` | ✅ |
| TH-1.4 | `AutocompleteController` не формирует `extraBody` для локального провайдера | ✅ |

## Связи

- **Используется:** ChatViewProvider, ChatPanel, EditController, AgentController (прокидывание `extraBody` в `provider.chat`)
- **Использует:** `CompletionOptions.extraBody` → `OpenAIProvider.chat()` (спред в тело запроса)
- **Конфигурация:** `llmAssistant.disableThinking`

## Детали реализации

- **Детект deepseek:** регулярка `/deepseek/i.test(model)` — параметр `thinking` поддерживают только deepseek-модели.
- **Автокомплит** отключает thinking всегда для deepseek (через `shouldDisableThinking({always:true})`), остальные режимы — по `disableThinking`.
- **Локальные модели:** `AutocompleteController` больше не проверяет модель регекспом вручную, а спрашивает `shouldDisableThinking`; `extraBody` для `isLocal` не формируется.
- **Прокидывание:** `extraBody` попадает в `CompletionOptions`, а `openai.ts` раскрывает его `...(options.extraBody ?? {})` в тело запроса к OpenAI SDK.

## История изменений

| Версия | Дата | Изменения |
|--------|------|-----------|
| 0.14.1 | 2026-11-07 | Stage 4: `shouldDisableThinking` реализована как чистая функция, автокомплит переведён на неё (тип провайдера вместо регекспа модели), локальному `extraBody` не отправляется; `thinking.test.ts` — 6 тестов (первый тест у модуля вообще) |
| 0.14.0 | 2026-11-07 | Два механизма (deepseek `thinking`, ollama `think`); чистая `shouldDisableThinking`; локальные модели не используют `extraBody` |
| 0.13.0 | 2026-08-23 | Базовая реализация (фикс пустого `content` у reasoning-моделей deepseek) |
