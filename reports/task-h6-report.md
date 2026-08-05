# Задача 6: Run History Dashboard — Отчёт

**Дата:** 2026-08-05
**Слой:** 07 Product Shell
**Коммит:** `beb05a3`
**Ветка:** `main`

---

## Выполненные работы

### 1. Создан `src/shared/RunHistoryStore.ts`
- Тип `RunEntry` с полями: id, timestamp, mode, task, provider, model, steps, tokensIn, tokensOut, cost, duration, status, error
- `recordRun(entry)` — запись запуска (FIFO, макс. 100)
- `getRuns(limit?)` — получить историю
- `clearHistory()` — очистка
- Хранение: `ExtensionContext.globalState` (persistent)

### 2. Создан `src/modes/history/HistoryViewProvider.ts`
- Отдельный WebViewViewProvider для вкладки «История» в Activity Bar
- Таблица с колонками: дата, режим, задача, шаги, токены, статус
- Фильтр по режиму (все / чат / агент / edit)
- Кнопка очистки истории
- Клик по записи → панель с деталями запуска

### 3. Интегрирована запись в рантайм
- **ChatViewProvider.handleSendMessage()**: запись при успешном чате/агенте, ошибке, отмене
  - Новый метод `recordChatRun()` вычисляет стоимость по модели
- **registerCommands.ts / startApplyMode()**: запись запусков Apply-режима
  - Успех, ошибка, отмена — все статусы

### 4. Обновлён `package.json`
- Добавлена команда `llmAssistant.openHistory`
- Добавлен view `llmAssistant.history` в контейнер `llmAssistant`

### 5. Обновлён `extension.ts`
- Создание `RunHistoryStore` и `HistoryViewProvider` при активации
- Проброс в `ChatViewProvider` и `registerCommands`

### 6. Написаны юнит-тесты (`test/suite/runHistoryStore.test.ts`)
- 15 тестов, включая AC-6.6 (FIFO 100 записей)
- Персистентность, все режимы, уникальность ID

---

## Acceptance Criteria — статус

| # | Критерий | Статус | Комментарий |
|---|----------|--------|-------------|
| AC-6.1 | Запуск агента сохраняется в историю | ✅ | Интегрировано в startApplyMode (registerCommands.ts) — запись при success/error/cancelled/limit_exceeded |
| AC-6.2 | Запуск чата сохраняется в историю | ✅ | Интегрировано в ChatViewProvider.handleSendMessage() — запись при success/error/cancelled |
| AC-6.3 | WebView: вкладка «История» с таблицей | ⚠️ Ручной тест | HistoryViewProvider реализован, отображается в Activity Bar как «История». Требуется ручная проверка в VS Code |
| AC-6.4 | Фильтр по режиму (чат/агент/edit) | ⚠️ Ручной тест | Реализован select с опциями «Все»/«Чат»/«Агент»/«Edit». Требуется ручная проверка в VS Code |
| AC-6.5 | Очистка истории | ⚠️ Ручной тест | Кнопка «🗑 Очистить» с confirm-диалогом. Требуется ручная проверка в VS Code |
| AC-6.6 | Max 100 записей, старые вытесняются (FIFO) | ✅ | Юнит-тесты: «FIFO: максимум 100 записей, 101-я вытесняет самую старую», «FIFO: 150 записей → только 100 сохранено» |
| AC-6.7 | История не теряется при перезагрузке VS Code | ⚠️ Ручной тест | Хранение через globalState (persistent). Тест «данные сохраняются между созданиями экземпляров» подтверждает на уровне юнитов. Требуется ручная проверка в VS Code |
| AC-6.8 | `npm run compile` без ошибок | ✅ | webpack compiled successfully |
| AC-6.9 | Существующие тесты не сломаны | ✅ | 143 passing (15 новых + 128 существующих) |

**Итого:** 5 ✅ автоматически подтверждены, 4 ⚠️ требуют ручной проверки.

---

## Файлы

### Новые файлы (3)
| Файл | Размер |
|------|--------|
| `src/shared/RunHistoryStore.ts` | ~3.9 KB |
| `src/modes/history/HistoryViewProvider.ts` | ~14 KB |
| `test/suite/runHistoryStore.test.ts` | ~8 KB |

### Изменённые файлы (7)
| Файл | Изменения |
|------|-----------|
| `package.json` | +views, +команда openHistory |
| `src/extension.ts` | +RunHistoryStore, +HistoryViewProvider |
| `src/activation/registerCommands.ts` | +запись в RunHistoryStore, +команда openHistory |
| `src/modes/chat/ChatViewProvider.ts` | +recordChatRun, запись в историю |
| `test/suite/index.ts` | +runHistoryStore.test |
| `test/run-mocked.js` | +runHistoryStore.test |

---

## Затраты

| Параметр | Значение |
|----------|----------|
| Провайдер | deepseek-v4-pro |
| Входные токены | ~4 500 (оценка) |
| Выходные токены | ~9 000 (оценка) |
| Стоимость | ~$0.006 (4.5K × $0.435/M + 9K × $0.87/M) |
| Время выполнения | ~15 мин |

---

## Примечания
- Линтер ESLint выдаёт ошибку «Couldn't find a configuration file» — это предсуществующая проблема проекта (нет `.eslintrc`), не связана с задачей 6
- WebView вкладка «История» — это отдельный view в Activity Bar (рядом с «Чат»), а не таб внутри чата, что соответствует требованиям PLAN-HARNESS.md
- Для ручной проверки AC-6.3/6.4/6.5/6.7: установить VSIX и протестировать
