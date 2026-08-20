# PLAN: v0.11.0 — Standalone AI-ревью (P2)

**Версия:** 0.11.0
**Spec:** specs/CodeReviewer.md
**Цель:** вынести ReviewerAgent из Plan Mode `reflect()` в standalone-ревьюер кода + команда «Review File».

---

## Этап 1: CodeReviewer + промпт

| AC | Критерий | Статус |
|----|----------|--------|
| CR-1 | `reviewFile` запускает ReviewerAgent (ReAct, maxIterations=8, skipGlobalAllowList) | planned |
| CR-2 | `reviewCode` передаёт код в задачу и ревьюит без чтения с диска | planned |
| CR-4 | Пустой код/путь → ранний возврат ошибки без вызова LLM | planned |
| CR-6 | Отмена по `signal` не зависает | planned |

**Действия:**
1. `src/modes/review/CodeReviewer.ts` — новый компонент (`reviewFile`, `reviewCode`, `CodeReviewResult`)
2. `CODE_REVIEW_SYSTEM_PROMPT` — директивный промпт (стиль/безопасность/корректность/оптимизация)
3. `specs/CodeReviewer.md` — уже создан (черновик)

**Gate 1:** `tsc` 0 ошибок · `npm run test:mocked` 0 провалов

---

## Этап 2: Команда «Review File» + показ отчёта

| AC | Критерий | Статус |
|----|----------|--------|
| CR-5 | Команда «LLM Assistant: Review File» ревьюит активный файл и показывает отчёт | planned |

**Действия:**
1. `src/activation/registerCommands.ts` — команда `llmAssistant.review.file`: читает активный редактор (файл или выделение) → `CodeReviewer` → отчёт
2. Показ отчёта — **решение в clarify** (чат-сообщение / Output Channel / отдельная панель)
3. `specs/registerCommands.md` — обновить

**Gate 2:** команда видна в Command Palette · отчёт рендерится

---

## Этап 3: Тесты + приёмка

| AC | Критерий | Статус |
|----|----------|--------|
| CR-3 | Отчёт содержит секции стиль/безопасность/корректность/оптимизация | planned |
| CR-7 | Юнит-тесты CodeReviewer (мок AgentWorker) | planned |
| CR-8 | E2E-тест команды ревью | planned |
| CR-9 | CHANGELOG обновлён | planned |

**Действия:**
1. `test/suite/codeReviewer.test.ts` (+ в run-mocked.js)
2. `test/suite/e2e/review.e2e.ts` (+ в index.ts)
3. `CHANGELOG.md` → 0.11.0
4. Коммиты + push + зелёный CI

---

## Затронутые файлы

| Файл | Изменение |
|------|-----------|
| `src/modes/review/CodeReviewer.ts` | новый |
| `src/activation/registerCommands.ts` | +команда review.file |
| `src/modes/chat/ChatViewProvider.ts` | +метод показа отчёта (если чат-сообщение) |
| `specs/CodeReviewer.md` | новый |
| `specs/registerCommands.md` | обновлён |
| `specs/ARCHITECTURE.md` | +CodeReviewer в карту |
| `test/suite/codeReviewer.test.ts`, `test/suite/e2e/review.e2e.ts` | новые |
