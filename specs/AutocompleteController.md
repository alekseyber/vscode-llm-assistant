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

Управляет логикой: получает контекст из `ContextBuilder`, отправляет в LLM, отображает через `GhostTextManager`.

### ContextBuilder

Строит контекст: prefix (до курсора) + suffix (после курсора) с учётом лимита токенов.

### GhostTextManager

Отображает ghost text в редакторе через VS Code InlineCompletionItemProvider.

## Связи

- **Использует:** ProviderManager
- **Используется:** registerCommands (регистрация провайдера автокомплита)
- **Конфигурация:** `llmAssistant.autocomplete.enabled`

## Детали реализации

- **ContextBuilder:** prefix (до курсора) + suffix (после), лимит chars/4
- **GhostTextManager:** InlineCompletionItemProvider API
- **Debounce:** ~300ms после ввода


## История изменений

| Версия | Дата | Изменения |
|--------|------|-----------|
| 0.1.0 | 2026-08-04 | Базовая реализация |
