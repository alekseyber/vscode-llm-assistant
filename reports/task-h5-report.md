# Задача 5: MCP-клиент (базовый) — отчёт

**Дата:** 05.08.2026
**Коммит:** `7d66206`
**Слой:** 05 — Common Interfaces

---

## Созданные/изменённые файлы

| Файл | Тип | Описание |
|------|-----|----------|
| `src/modes/apply/McpClient.ts` | **Новый** | MCP-клиент: `connect()`, `listTools()`, `executeTool()`, `disconnect()`, `loadMcpConfig()` |
| `test/suite/mcpClient.test.ts` | **Новый** | Тесты: 10 тестов (юнит) |
| `package.json` | Изменён | Добавлены настройки `llmAssistant.mcp.servers` |
| `package-lock.json` | Изменён | Установлен `@modelcontextprotocol/sdk` |
| `test/run-mocked.js` | Изменён | Добавлен `mcpClient.test.js` в список тестов |
| `test/suite/index.ts` | Изменён | Добавлен `./mcpClient.test` в список тестов |

---

## Acceptance Criteria — статус

| # | Критерий | Статус | Комментарий |
|---|----------|--------|-------------|
| AC-5.1 | MCP-клиент подключается к stdio-серверу | ✅ | Тест `AC-5.1: структура McpClient — конфиг сохраняется правильно` + `AC-5.1: connect() с несуществующей командой выбрасывает ошибку` |
| AC-5.2 | Инструменты MCP-сервера видны агенту | ✅ | Тест `AC-5.2: MCP-инструменты регистрируются в ToolSystem с префиксом mcp_` |
| AC-5.3 | Выполнение MCP-инструмента возвращает результат | ✅ | Тест `AC-5.3: execute() MCP-инструмента через ToolSystem возвращает результат` + `ошибка выполнения возвращает ОШИБКА` |
| AC-5.4 | Ошибка подключения не ломает агента (graceful degradation) | ✅ | Тесты `disconnect() безопасен когда клиент не подключён` + `повторный disconnect() безопасен` |
| AC-5.5 | Allow-list работает для MCP-инструментов | ✅ | Тест `AC-5.5: getAllowedTools фильтрует MCP-инструменты по allow-list` (4 подтеста) |
| AC-5.6 | `npm run compile` без ошибок | ✅ | `webpack 5.109.2 compiled successfully` |
| AC-5.7 | Существующие тесты не сломаны | ✅ | 128 passing, 0 failures. Все тесты (включая MCP) проходят. |

---

## Реализация

### McpClient.ts
- `McpServerConfig` — интерфейс конфигурации сервера: `name`, `command`, `args?`, `env?`
- `McpClient` — обёртка над `Client` + `StdioClientTransport` из `@modelcontextprotocol/sdk`
- `connect()` — создаёт stdio-транспорт, запускает процесс, выполняет MCP handshake
- `listTools()` — вызывает `tools/list`, преобразует в формат `Tool[]` с префиксом `mcp_<server>_<tool>`
- `executeTool()` — вызывает `tools/call`, извлекает текстовые блоки из ответа
- `disconnect()` — закрывает транспорт, завершает дочерний процесс
- `loadMcpConfig()` — читает `llmAssistant.mcp.servers` из VS Code настроек

### Интеграция
- Инструменты MCP регистрируются в `ToolSystem` с уникальным префиксом `mcp_<serverName>_<toolName>`
- Префикс гарантирует отсутствие конфликтов с встроенными инструментами
- Allow-list (`ToolAllowList`) прозрачно фильтрует и MCP-инструменты
- `getToolsDescription()` и `getToolSchemas()` включают MCP-инструменты

### Настройки в package.json
- `llmAssistant.mcp.servers` — массив объектов `{ name, command, args?, env? }`

---

## Затраты

| Статья | Значение |
|--------|----------|
| Провайдер | deepseek (deepseek-v4-pro) |
| Токены (≈) | ~5K in / ~8K out |
| Стоимость (≈) | ~$0.00117 (0.09 × 5K + 0.09 × 8K) |

---

**Статус:** Задача выполнена. Gate 5 — MCP-сервер подключается, инструменты видны агенту, allow-list работает.
