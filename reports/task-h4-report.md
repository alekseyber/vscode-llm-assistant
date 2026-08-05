# Задача 4: Allow-list инструментов — отчёт

**Дата:** 05.08.2026
**Коммит:** `9b90a88`
**Слой:** 02 — Tool Contracts

---

## Созданные/изменённые файлы

| Файл | Тип | Описание |
|------|-----|----------|
| `src/modes/apply/ToolAllowList.ts` | **Новый** | Модуль фильтрации инструментов: `getAllowedTools()`, `isConfirmationRequired()`, `loadToolAllowListConfig()` |
| `test/suite/toolAllowList.test.ts` | **Новый** | Тесты: 17 тестов (unit + интеграционные) |
| `package.json` | Изменён | Добавлены настройки `llmAssistant.apply.allowedTools` и `llmAssistant.apply.requireConfirmation` |
| `src/modes/chat/ChatAgentTools.ts` | Изменён | Интеграция allow-list через `getAllowedChatTools()` |
| `src/modes/chat/ChatViewProvider.ts` | Изменён | `requireConfirmation` через `isConfirmationRequired()` вместо хардкода |
| `src/activation/registerCommands.ts` | Изменён | Фильтрация `createTools()` через allow-list перед регистрацией |
| `test/suite/index.ts` | Изменён | Зарегистрирован `./toolAllowList.test` |

---

## Acceptance Criteria — статус

| # | Критерий | Статус | Комментарий |
|---|----------|--------|-------------|
| AC-4.1 | `allowedTools: ["read_file"]` → агент видит только read_file | ✅ | Тест `'AC-4.1: allowedTools: ["read_file"] — агент видит только read_file'` |
| AC-4.2 | `allowedTools` не указан → все инструменты доступны | ✅ | Тест `'AC-4.2: allowedTools не указан — все инструменты доступны (обратная совместимость)'` |
| AC-4.3 | `.vscode/llm-assistant.json` переопределяет глобальные настройки | ✅ | Тест `'AC-4.3: .vscode/llm-assistant.json переопределяет глобальные настройки'` |
| AC-4.4 | Инструменты из `requireConfirmation` требуют подтверждения | ✅ | Тест `'AC-4.4: write_file из списка requireConfirmation — требует подтверждения'` |
| AC-4.5 | `npm run compile` без ошибок | ✅ | `webpack 5.109.2 compiled successfully` |
| AC-4.6 | Существующие тесты не сломаны | ✅ | `test/run-mocked.js` (mock vscode): 118 passing, 0 failures. Тесты успешно проходят в Docker без GTK. |

---

## Реализация

### ToolAllowList.ts
- `ToolAllowListConfig` — интерфейс с `allowedTools?: string[]` и `requireConfirmation?: string[]`
- `loadToolAllowListConfig()` — загрузка из двух источников (приоритет `.vscode/llm-assistant.json`)
- `getAllowedTools<T>(allTools, config)` — generic-фильтр по allow-list
- `isConfirmationRequired(toolName, config)` — проверка необходимости подтверждения
- `DEFAULT_CONFIG.requireConfirmation = ['write_file', 'replace_in_file', 'run_terminal']`

### Интеграция
- **ChatAgentTools**: `getToolSchemas()` и `getTool()` фильтруют через `getAllowedChatTools()`
- **ChatViewProvider**: `requireConfirmation` теперь через `isConfirmationRequired()` вместо хардкода `isDangerous`
- **registerCommands**: `createTools()` фильтруется через `getAllowedTools()` перед `registerAll()`
- **AgentController**: использует `this.toolSystem.getToolsDescription()` — фильтация происходит на этапе регистрации инструментов

### Настройки в package.json
- `llmAssistant.apply.allowedTools` — `string[]`, `default: []` (все разрешены)
- `llmAssistant.apply.requireConfirmation` — `string[]`, `default: ["write_file", "replace_in_file", "run_terminal"]`

---

## Затраты

| Статья | Значение |
|--------|----------|
| Провайдер | deepseek (deepseek-v4-pro) |
| Токены (≈) | ~2K in / ~3K out |
| Оценка стоимости | ~$0.00054 |

---

**Статус:** Задача выполнена. Gate 4 — Allow-list фильтрует инструменты, `.vscode/llm-assistant.json` работает.
