---
component: WebView
version: 0.8.0
status: stable
since: 0.1.0
---

## Назначение

Фронтенд чата в VS Code WebView. Рендерит сообщения, обрабатывает стриминг, управляет сессиями, провайдерами, confirmation dialog.

## Компоненты

| Файл | Назначение | Строк |
|------|-----------|-------|
| `index.html` | Разметка: messagesContainer, input, sidebar | ~150 |
| `main.js` | Логика: сообщения, стриминг, сессии, провайдеры, тулбар | 912 |
| `toolbar.js` | Декларативный реестр `TOOLBAR_ACTIONS` (P0) | ~30 |
| `toolActivity.js` | Маппинг `tool_name → {label, icon}` + описание вызова (P0) | ~80 |
| `styles.css` | Стили: чат, кнопки, контекст-бар | ~500 |

## Интерфейс (postMessage)

### От WebView к Extension

| Тип | Назначение |
|-----|-----------|
| `sendMessage` | Отправка сообщения (text, mode, provider, model) |
| `cancelRequest` | Отмена запроса |
| `ready` | WebView загружен |
| `newSession` / `switchSession` / `deleteSession` / `renameSession` / `toggleFavorite` | Управление сессиями |
| `clearAllSessions` | Удалить все сессии и логи (кнопка в ⋮-меню тулбара) |
| `attachFile` | Прикрепление файла (text или image) |
| `confirmResponse` | Ответ на диалог подтверждения |

### От Extension к WebView

| Тип | Назначение |
|-----|-----------|
| `streamChunk` | Чанк текста для стриминга |
| `done` | Завершение стрима |
| `userMessage` | Эхо своего сообщения |
| `error` / `cancelled` | Ошибка / отмена |
| `history` | Полная история сообщений |
| `sessionList` | Список сессий |
| `providerList` | Список провайдеров |
| `tokens` | Использование токенов |
| `retryStatus` | Статус ретрая |
| `confirmAction` | Запрос подтверждения |

## Контракты

| Ситуация | Поведение |
|----------|-----------|
| Стрим-чанк | Добавляется в currentMessage, Markdown рендерится в конце |
| Завершение стрима | Кнопки копирования кода, скролл |
| Нет marked.js | Ошибка «Не удалось загрузить компонент» |
| HTML в сообщениях | Экранируется через escapeHtml |
| Код-блоки | Подсветка: js, ts, python, html, css, json, bash, sql |
| Контекст-бар | Зелёный <80%, жёлтый >80%, красный >100% (overflow + пульсация) |
| Ретрай | Жёлтый индикатор, сброс при streamChunk |

## Детали реализации

- **IIFE:** весь код в `(function() { 'use strict'; ... })()`
- **Markdown:** `marked.parse()` с `{ breaks: true, gfm: true }`. Экранирование HTML до рендера, восстановление ссылок после.
- **Стриминг:** буферизация чанков в `streamBuffer`. При `done` — финальный рендер + `streamingMessage = null`.
- **Сессии:** рендерятся в `#session-list` (левый сайдбар, P0 Этап 2 — вместо dropdown). Группировка по датам: Сегодня / Вчера / 7 дней / Ранее. Элемент: имя (⭐ если избранная) + превью + время + hover-действия (избранное/переименовать/удалить). Активная выделяется классом `active`. Переключение — клик по элементу. **Дровер (0.13.0-fix):** сайдбар — оверлей (`position:absolute`), выезжает по кнопке ☰ (`#btn-toggle-sidebar`), закрывается кнопкой ✕ (`#btn-close-sidebar`) или по подложке `#sidebar-backdrop`; не резервирует ширину (`transform: translateX(-100%)` → `translateX(0)` + класс `open`), `#chat-main` занимает всю ширину.
- **Подсветка кода:** ручная (не highlight.js) — regex-правила для 8 языков. Добавляется `hljs-keyword`, `hljs-string`, `hljs-comment`, `hljs-number`, `hljs-title`.
- **Confirmation:** модальное окно с `requestId`. Ответ через `confirmResponse`.
- **Провайдеры:** селектор `<select id="provider-select">`, модели обновляются при смене провайдера.
- **Тулбар ⋮ (P0, Этап 1):** кнопки шапки рендерятся из декларативного реестра `TOOLBAR_ACTIONS` (`toolbar.js`, UMD: глобал в WebView + `module.exports` для тестов). `primary: true` → видимая иконка, остальные — в ⋮-меню (`#toolbar-menu`). Деструктив (очистить/удалить сессию/удалить все) — `primary: false` и `danger: true`. «Удалить все сессии» шлёт `clearAllSessions`.
- **Activity-feed (P0, Этап 3):** tool-шаги рендерятся дружелюбно через `toolActivity.js` (`describeToolCall(toolName, args)` → `{icon, label, detail}`) вместо сырого `🔧 toolName`. Индикатор «Думаю…» + счётчик шагов `· N` + кнопка «Остановить».
- **Input-toolbar (P0, Этап 4):** тумблеры режимов `Ask` (чат) / `Agent` / `План` / `Субагенты` (`#input-toolbar`, сегментированный контрол) вместо `#mode-select` + чекбокса Plan Mode. `currentMode` ∈ `ask|agent|plan|subagents`; `sendUserMessage` маппит: ask→`mode:'chat'`, plan→`planMode:true`, subagents→`@orchestrate <text>`. При загрузке активен `Agent` (AC P0-4.3).
- **Токены:** `MODEL_PRICES` в main.js — хардкод (дублирует types.ts). Контекст-бар: `.context-bar-fill { width: N% }`.
- **Контекст-бар:** `width: 120px; flex-shrink: 0` (не `flex: 1`). `context-overflow` — красный с пульсацией.
- **Welcome:** `#welcome-message` скрывается при первом сообщении.
- **Скролл:** `messagesContainer.scrollTop = messagesContainer.scrollHeight`.

## Форматы данных

### history
```json
{
  "type": "history",
  "messages": [
    {"role": "user", "content": "...", "context": {"filePath": "...", "content": "..."}}
  ]
}
```

### sessionList
```json
{
  "type": "sessionList",
  "sessions": [{"id": "...", "name": "...", "createdAt": 123, "lastActiveAt": 123, "messageCount": 5, "favorite": false, "preview": "..."}],
  "activeId": "..."
}
```

### tokens
```json
{"type": "tokens", "inputTokens": 1234, "outputTokens": 567, "model": "deepseek-v4-pro"}
```

## Связи

- **Использует:** `marked.min.js` (Markdown-рендеринг)
- **Общается с:** `ChatViewProvider` (postMessage)

## Тесты

Прямых тестов нет. Покрывается через ручное тестирование:
- Чат: отправка, стриминг, markdown, подсветка кода
- Сессии: создание, переключение, удаление
- Провайдеры: выбор, смена моделей
- Контекст-бар: заполнение, пороги, пульсация
- Confirmation dialog: запрос → ответ

## История изменений

| Версия | Дата | Изменения |
|--------|------|-----------|
| 0.13.0 | 2026-08-22 | P0 Этап 4: input-toolbar тумблеров (Ask/Agent/План/Субагенты) вместо mode-select + чекбокса Plan Mode |
| 0.13.0 | 2026-08-23 | Дровер сайдбара: оверлей + кнопка ☰ + подложка — не резервирует ширину при узком webview |
| 0.13.0 | 2026-08-23 | ✏️ переименование сессии → инлайн-инпут (`.session-rename-input`; `window.prompt` в WebView не работает) |
| 0.13.0 | 2026-08-22 | P0 Этап 3: activity-feed — маппинг `tool_name→{label,icon}` (`toolActivity.js`), «Думаю…» + счётчик шагов |
| 0.13.0 | 2026-08-22 | P0 Этап 2: левый сайдбар сессий (группировка, превью, избранное/переименовать/удалить) вместо dropdown |
| 0.13.0 | 2026-08-22 | P0 Этап 1: тулбар ⋮ — реестр `TOOLBAR_ACTIONS` (`toolbar.js`), primary-иконки + ⋮-меню, «Удалить все сессии» (`clearAllSessions`) |
| 0.1.0 | 2026-08-04 | Базовая реализация |
