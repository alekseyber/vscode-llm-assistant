---
component: proposalPreview
layer: 03 Core
version: 0.14.38
status: implemented
source: src/modes/edit/proposalPreview.ts
---

# proposalPreview

## Назначение

Чистая функция, собирающая полный текст файла до и после замены выделенного диапазона.
Пара подаётся в `vscode.diff`, чтобы пользователь увидел настоящий красно-зелёный diff,
а не подсветку мест вставки.

## Интерфейс

```ts
buildProposalPreview(fullText: string, startOffset: number, endOffset: number, newText: string): ProposalPreview
```

`ProposalPreview = { before: string; after: string }`.

## Контракты

- `before` — всегда исходный `fullText`.
- `after` = `fullText.slice(0, start) + newText + fullText.slice(end)`.
- Смещения обрезаются по границам текста, инвертированный диапазон (`end < start`) не даёт отрицательной длины.
- Пустой диапазон (`start === end`) — вставка в позицию.

## Связи

- Используется в `EditController.showProposalDiff`.
- Тесты: `PP-1` (замена внутри файла), `PP-2` (многострочное выделение), `PP-3` (вставка без выделения), `PP-4` (выход за границы).

## История изменений

| Версия | Дата | Изменение |
|---|---|---|
| 0.14.38 | 2026-11-08 | Функция создана: пара «до/после» для diff-предпросмотра правки |
