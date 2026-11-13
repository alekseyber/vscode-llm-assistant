# contextWindow

**Версия:** 0.1.0
**Файл:** `src/shared/contextWindow.ts`

## Назначение

Бюджет истории чата раньше был фиксированным (`chat.maxContextTokens` = 4096), и на модели с окном
32k–128k история резалась в разы сильнее возможного. Модуль считает эффективный бюджет по окну модели.

## Интерфейс

| Функция | Вход | Выход |
|---------|------|-------|
| `resolveContextTokens(input)` | `{ model, providerWindow?, configured?, fallback? }` | `{ tokens, source, window? }` |
| `knownContextWindow(model)` | имя модели | окно по таблице семейств или `undefined` |
| `reserveForAnswer(window)` | окно | резерв под ответ: `min(4096, max(512, 15% окна))` |

## Контракты

- Окно берётся у провайдера (`providerWindow`, например `numCtx` Ollama), иначе — из таблицы семейств по имени модели.
- `configured > 0` — жёсткий потолок: `tokens = min(configured, окно − резерв)`. Потолок **сужает** окно и не может его расширить.
- `configured = 0` — авто по окну модели (значение по умолчанию в манифесте).
- Окно неизвестно: `configured > 0` → `tokens = configured` (источник `setting`), иначе `fallback` (4096, источник `fallback`).
- Минимум — 1024 токена, даже если окно крошечное.
- Возвращается причина (`source`), чтобы индикатор токенов и логи объясняли, откуда взялось число.

## Связи

`ConversationManager.getMessagesForRequest` (обрезка истории), `ChatViewProvider.getMaxContextTokens` (индикатор),
`OllamaProvider.contextWindow` (окно из `numCtx`). Настройка описана в README и `docs/llma.md`.

## История изменений

| Версия | Дата | Изменения |
|--------|------|-----------|
| 0.1.0 | 2026-11-13 | P30: бюджет по окну модели вместо фиксированных 4096; потолок-настройка |
