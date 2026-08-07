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

## Контракты

| Ситуация | Поведение |
|----------|-----------|
| Выделение пустое | Предупреждение |
| Нет активного редактора | Предупреждение |
| Провайдер не настроен | Ошибка |
| Код не изменился | Уведомление |
| AbortError | «Редактирование отменено» |
| Ошибка LLM | showErrorMessage |

## Связи

- **Использует:** ProviderManager, diff.ts
- **Используется:** registerCommands (команда `llmAssistant.edit`)

## Детали реализации

- **Flow:** handleEditSelection → promptForInstruction → sendEditRequest → showDiff → accept/reject
- **Промпт:** системный с языком файла, инструкцией; пользовательский: выделенный код в ```
- **Модель:** `defaultModel` из конфига
- **Стриминг:** `provider.chat({stream:true})`, сборка полного ответа
- **Очистка ответа:** `cleanLlmResponse()` — regex для ```code``` блоков и одинарных ```
- **Diff:** `computeDiff(oldText, newText)` → `diffResult` (addedCount, removedCount, изменения)
- **Декорации:** `applyDiffDecorations()` — зелёный/красный; `clearDiffDecorations()` — очистка
- **Accept:** `acceptChanges()` через `editor.edit()`, автосохранение; Reject: очистка декораций
- **Статус-бар:** `createStatusBarItem` с командами `llmAssistant.edit.accept/reject`
- **Команды:** временная регистрация `vscode.commands.registerCommand`, dispose при cleanup
- **Сессия:** `EditSession` — editor, selection, oldText, newText, diffResult, statusBarItems
- **Отмена:** AbortController + `window.withProgress(cancellable:true)`
- **Ошибки:** AbortError → «отменено», остальные → showErrorMessage

## Промпты

### Системный
```
Ты — ассистент для редактирования кода в VS Code.
Файл: {fileName}
Язык: {languageId}
Инструкция: {instruction}
Верни ТОЛЬКО изменённый код, без пояснений.
```

### Пользовательский
```
Вот выделенный код:
```{ext}
{selectedText}
```
Измени его: {instruction}
```


## Тесты

Прямых тестов нет. Покрывается ручным тестированием: выделение → Ctrl+I → diff.

## История изменений

| Версия | Дата | Изменения |
|--------|------|-----------|
| 0.1.0 | 2026-08-04 | Базовая реализация |
