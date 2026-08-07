---
component: EditController
version: 0.8.0
status: beta
since: 0.1.0
---

## Назначение

Режим редактирования (Ctrl+I): выделение текста → запрос к LLM → inline diff.

## Интерфейс

### `new EditController(providerManager)`

### Применение

Выделенный текст → `provider.chat()` с системным промптом → вычисление diff → inline-замена в редакторе.

## Связи

- **Использует:** ProviderManager, diff.ts
- **Используется:** registerCommands (команда `llmAssistant.edit`)

## Детали реализации

- **Промпт:** системный «отредактируй выделенный код»
- **Diff:** `diff.ts` → inline-замена через VS Code TextEditor API


## Тесты

Прямых тестов нет. Покрывается ручным тестированием: выделение → Ctrl+I → diff.

## История изменений

| Версия | Дата | Изменения |
|--------|------|-----------|
| 0.1.0 | 2026-08-04 | Базовая реализация |
