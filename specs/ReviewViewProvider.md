---
component: ReviewViewProvider
version: 0.11.0
status: beta
---

## Назначение

WebviewViewProvider для вкладки «Ревью» в Activity Bar. Показывает **компактную строку-сводку** код-ревью (файл + стоимость); по клику открывает широкое окно `ReviewPanel` с полным markdown-отчётом.

## Интерфейс

```typescript
const REVIEW_VIEW_TYPE = 'llmAssistant.review';

class ReviewViewProvider implements vscode.WebviewViewProvider {
  constructor();
  resolveWebviewView(view, context, token): void;
  showReview(filePath: string, report: string, cost: number): void;
  onOpen?: (filePath: string, report: string, cost: number) => void;  // задаётся в extension.ts
}
```

## Контракты

| Ситуация | Поведение |
|----------|-----------|
| `showReview(filePath, report, cost)` | Сохраняет полный отчёт, Reveal-панель (`llmAssistant.review.focus`) и шлёт `reviewSummary` (файл + стоимость) |
| Клик по строке сводки в WebView | WebView шлёт `openReview` → вызывается `onOpen` с сохранённым полным отчётом |
| `ready` при открытии | Если есть сохранённая сводка — шлёт `reviewSummary` заново |
| `onOpen` не задан | Клик игнорируется (no-op) |

## Детали реализации

- HTML инлайнится, CSP `default-src 'none'; script-src 'unsafe-inline'`.
- Компактная кликабельная строка: «🔍 файл — стоимость» с иконкой ↗.
- Полный отчёт **не** рендерится в сайдбаре — только сводка; полный отчёт — в `ReviewPanel` (широкое окно).

## Связи

- **Используется:** `registerCommands.ts` (команда `review.file` → `showReview`), `extension.ts` (регистрация + `onOpen`).
- **Открывает:** `ReviewPanel` (широкое окно полного отчёта).

## Тесты

- `reviewViewProvider.test.ts` — `showReview` → `reviewSummary`, `openReview` → `onOpen`, jsdom-рендер сводки + клик → `openReview` (3 теста).

## История изменений

| Версия | Дата | Изменения |
|--------|------|-----------|
| 0.11.0 | 2026-08-20 | Первая версия: компактная сводка + открытие полного отчёта в широком окне |
| 0.11.0 | 2026-08-20 | Фикс: `showReview` постит сводку напрямую (гонка view-разрешения); `display:block` для показа сводки |
