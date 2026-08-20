---
component: AutocompleteController
version: 0.8.0
status: beta
since: 0.1.0
---

## Назначение

Ghost text автокомплит: контекст из редактора → LLM → предложение в виде серого текста (Tab для принятия).

## Компоненты

### AutocompleteController

Управляет логикой: подписка на `onDidChangeTextDocument`, debounce, запрос к LLM, отображение через GhostTextManager.

### ContextBuilder

Строит контекст: prefix (до курсора, ≤200 строк, ≤1500 токенов) + suffix (после курсора, ≤50 строк, ≤500 токенов).

### GhostTextManager

Реализует `InlineCompletionItemProvider`. Показывает ghost text, кэширует предложения.

## Интерфейс

### `new AutocompleteController(providerManager)`

### `toggleAutocomplete()` — вкл/выкл через `llmAssistant.autocomplete.enabled`

### `dispose()`

## Контракты

| Ситуация | Поведение |
|----------|-----------|
| Пользователь печатает | Debounce 500ms → запрос |
| Новый ввод до истечения debounce | Таймер сбрасывается, старый запрос отменяется |
| Не файловый документ (output) | Игнорируется |
| Неактивный редактор | Игнорируется |
| Одинаковое предложение 2 раза | Кэш блокирует повтор |
| Escape | Очистка ghost text, отмена запроса |
| Tab | Принятие (VS Code сам применяет InlineCompletionItem) |

## Детали реализации

### AutocompleteController

- **Debounce:** `setTimeout(fn, debounceMs)`, при новом вводе — `clearTimeout` + `abortController.abort()`
- **Настройки:** `llmAssistant.autocomplete.enabled` (bool), `llmAssistant.autocomplete.debounceMs` (int, default 500)
- **Запрос:** `provider.chat({stream:true, temperature:0.3, maxTokens:128})`, сборка полного ответа
- **Лимит:** 1024 символа для автокомплита
- **Очистка ответа:** `cleanLlmResponse()` — regex для ```code``` и одинарных ```
- **Ghost text:** `ghostTextManager.setSuggestion(text, range, uri)` → если false (кэш) — не показываем
- **Отмена:** AbortController, `isRequestInFlight` флаг
- **Команды:** `llmAssistant.autocomplete.accept`, `llmAssistant.autocomplete.dismiss`

### ContextBuilder

- **Алгоритм:**
  1. prefix: строки [position.line - 200, position.line], текст до position.character
  2. suffix: строки [position.line, position.line + 50], текст от position.character
  3. `truncateToTokens()`: удаление строк с начала (prefix) / с конца (suffix) пока не влезем в лимит
- **Оценка токенов:** `Math.ceil(text.length / 3.5)` (консервативная: русский ~2, код ~4)
- **MAX_PREFIX_LINES:** 200, **MAX_SUFFIX_LINES:** 50
- **MAX_PREFIX_TOKENS:** 1500, **MAX_SUFFIX_TOKENS:** 500

### GhostTextManager

- **Регистрация:** `vscode.languages.registerInlineCompletionItemProvider({pattern:'**'}, this)`
- **provideInlineCompletionItems:** проверка совпадения документа, позиции в range → `InlineCompletionList([item])`
- **Кэш:** `lastCacheEntry = {uri, suggestion}` — блокирует дублирование
- **Очистка:** `onDidChangeTextDocument` того же документа → `clearSuggestion()` (но не кэш)

## Промпты

### Системный
```
Ты — автокомплит для кода в VS Code.
Продолжи код в позиции курсора.
Верни ТОЛЬКО продолжение кода.
Не повторяй код, который уже есть в файле.
Не используй ``` или пояснения.
Ответ: не более 5-10 строк.
```

### Пользовательский
```
Файл: {filePath}
Язык: {languageId}

Код до курсора:
```
{prefix}
```

Код после курсора:
```
{suffix}
```

Продолжи код в позиции курсора:
```

## Тесты

- `contextBuilder.test.ts` — ContextBuilder: сбор префикса/суффикса, оценка токенов, позиция курсора
- `cleanLlmResponse.test.ts` — очистка ответа LLM от ```code``` обрамления (общая утилита)

## Связи

- **Использует:** ProviderManager, ContextBuilder, GhostTextManager
- **Используется:** registerCommands (регистрация провайдера автокомплита)
- **Конфигурация:** `llmAssistant.autocomplete.enabled`

## История изменений

| Версия | Дата | Изменения |
|--------|------|-----------|
| 0.8.0 | 2026-08-07 | Полные алгоритмические детали |
| 0.1.0 | 2026-08-04 | Базовая реализация |
