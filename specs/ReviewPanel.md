---
component: ReviewPanel
version: 0.11.0
status: beta
---

## Назначение

Широкое окно (WebviewPanel) для полного markdown-отчёта код-ревью. Открывается по клику на компактной строке во вкладке «Ревью» (`ReviewViewProvider.onOpen`). Рендер через `marked.min.js` (общий с чатом), полная ширина редактора.

## Интерфейс

```typescript
class ReviewPanel {
  static currentPanel: ReviewPanel | undefined;
  static createOrShow(context: vscode.ExtensionContext, filePath: string, report: string, cost: number): ReviewPanel;
}
```

## Контракты

| Ситуация | Поведение |
|----------|-----------|
| `createOrShow` при существующей панели | `reveal(column)` + обновить отчёт (`setReport`) |
| `createOrShow` без панели | Создать `createWebviewPanel` (широкое, `ViewColumn.One`/активная колонка) |
| `ready` от WebView | Отправить текущий отчёт (`showReview`) |
| Закрытие панели (`onDidDispose`) | `currentPanel = undefined` |

## Детали реализации

- Singleton-паттерн (как `ChatPanel`): одна панель, повторный вызов обновляет содержимое.
- `marked.min.js` читается из `src/webviews/chat/marked.min.js` через `context.extensionUri` и инлайнится.
- CSP `default-src 'none'; script-src 'unsafe-inline'`.
- Максимальная ширина контента `900px` по центру (комфортное чтение длинного отчёта).

## Связи

- **Использует:** `marked.min.js`, `vscode.WebviewPanel`.
- **Используется:** `ReviewViewProvider.onOpen` (клик по сводке), `extension.ts`.

## Тесты

- `reviewPanel` — создание панели покрыто E2E-активацией (см. `ReviewViewProvider.onOpen`); markdown-рендер идентичен `ReviewViewProvider` (jsdom).

## История изменений

| Версия | Дата | Изменения |
|--------|------|-----------|
| 0.11.0 | 2026-08-20 | Первая версия: широкое окно полного отчёта ревью |
