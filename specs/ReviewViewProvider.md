---
component: ReviewViewProvider
version: 0.11.0
status: beta
---

## Назначение

WebviewViewProvider для вкладки «Ревью» в Activity Bar (рядом с «Чат», «История», «Оркестратор»). Показывает markdown-отчёт standalone код-ревью (рендер через `marked.min.js`, общий с чатом). Заполняется командой `llmAssistant.review.file`.

## Интерфейс

```typescript
const REVIEW_VIEW_TYPE = 'llmAssistant.review';

class ReviewViewProvider implements vscode.WebviewViewProvider {
  constructor(extensionUri: vscode.Uri);
  resolveWebviewView(view, context, token): void;
  showReview(filePath: string, report: string, cost: number): void;
}
```

## Контракты

| Ситуация | Поведение |
|----------|-----------|
| `showReview(filePath, report, cost)` | Reveal-панель (`llmAssistant.review.focus`) и отправляет `showReview` в WebView |
| Панель не открыта (`view` undefined) | `postMessage` — no-op, отчёт сохранится в `currentReport`, покажется при открытии (`ready`) |
| `ready` от WebView при открытии | Если есть сохранённый отчёт — отправляет `showReview` заново |
| `marked.min.js` недоступен | Fallback-рендер: `parse` возвращает `<pre>` (без markdown) |
| Стоимость = 0 | Строка стоимости не показывается |

## Детали реализации

- HTML инлайнится (как `HistoryViewProvider`), CSP `default-src 'none'; script-src 'unsafe-inline'`.
- `marked.min.js` читается из `src/webviews/chat/marked.min.js` через `extensionUri` (общий файл с чатом).
- Отчёт рендерится через `marked.parse(text, { breaks: true, gfm: false })`.
- Палитра Dark+ (те же цвета, что в чате/истории).
- `showReview` вызывает `vscode.commands.executeCommand('llmAssistant.review.focus')` для reveal.

## Связи

- **Использует:** `marked.min.js` (webview-ресурс), `vscode.WebviewView`.
- **Используется:** `registerCommands.ts` (команда `review.file` → `showReview`), `extension.ts` (регистрация провайдера).

## История изменений

| Версия | Дата | Изменения |
|--------|------|-----------|
| 0.11.0 | 2026-08-20 | Первая версия: панель «Ревью» для отчётов код-ревью |
