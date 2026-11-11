---
component: GhostTextManager
version: 0.1.0
status: beta
since: 0.2.0
---

## Назначение

Провайдер inline-завершений (`vscode.InlineCompletionItemProvider`): показывает ghost text —
короткое продолжение кода в позиции курсора. Контекст собирает `ContextBuilder`, запрос к модели
делает переданная функция `requestCompletion` (её подставляет `AutocompleteController`).

До 0.22.2 файл не имел ни одного теста, хотя это самая заметная пользователю поверхность
расширения (аудит 11.11, P24 S2).

## Интерфейс

```ts
class GhostTextManager implements vscode.InlineCompletionItemProvider {
  constructor(
    requestCompletion: (ctx: AutocompleteContext, signal?: AbortSignal) => Promise<string | null>,
    isEnabled: () => boolean,
  );
  provideInlineCompletionItems(document, position, context, token): Promise<vscode.InlineCompletionList | null>;
  clearSuggestion(): void;
  dispose(): void;
}
```

## Контракты

`provideInlineCompletionItems` возвращает `null` или список из одного `InlineCompletionItem`.

Молчит, если:

- автокомплит выключен (`isEnabled()` === false);
- схема документа не `file`, `untitled` или `vscode-remote` (output, diff, терминал);
- токен отмены уже отменён;
- контекст пустой (нет ни префикса, ни суффикса);
- модель вернула пустой ответ или ответ из одних пробелов;
- **тот же** ответ уже предлагался в этом же документе (кэш «не повторять дважды»);
- запрос завершился ошибкой — ошибка не выносится пользователю как подсказка.

Показывает подсказку, если ответ непустой. Диапазон вставки — точка курсора (`Range(position, position)`).
`clearSuggestion()` сбрасывает кэш (вызывается при Tab/Escape и при выключении автокомплита).

Отмена: `CancellationToken` VS Code превращается в `AbortSignal` и передаётся в запрос; подписка
снимается в `finally` после завершения запроса.

## Детали реализации

- Провайдер регистрируется в конструкторе для `{ pattern: '**' }` и снимается в `dispose()`;
- кэш хранит пару «текст предложения + URI документа», поэтому одинаковый ответ в другом файле
  показывается снова;
- `console.log` помечает причины молчания — по ним диагностируют «почему нет подсказки».

## Тесты

`test/suite/autocomplete.test.ts` — `GHT-1..8`: выключенный автокомплит, чужая схема документа,
пустой ответ, показ и позиция вставки, кэш повтора, различие документов, отмена через токен,
ошибка модели.

Мок `vscode` расширен живыми классами `InlineCompletionItem`, `InlineCompletionList`,
`CancellationTokenSource` и регистрацией провайдеров (`vscode.__inlineProviders`) — тесты
вызывают провайдер так же, как это делает редактор.

## Что не покрыто сознательно

Визуальная отрисовка ghost text (цвет, «призрачный» шрифт) — это VS Code, не расширение.

## Связи

- `AutocompleteController` — создаёт менеджер, даёт `requestCompletion` и `isEnabled`;
- `ContextBuilder` — собирает префикс/суффикс для запроса;
- мок `test/mocks/vscode/index.js` — регистрация провайдеров и токены отмены.

## История изменений

| Версия | Дата | Изменения |
|--------|------|-----------|
| 0.1.0 | 2026-11-11 | Первая спека: контракт провайдера зафиксирован, добавлены `GHT-1..8`. До этого файл (143 строки) не имел тестов |
