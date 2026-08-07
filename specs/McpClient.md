---
component: McpClient
version: 0.8.0
status: stable
since: 0.5.0
---

## Назначение

Клиент для подключения к MCP-серверам (Model Context Protocol). Загружает конфигурацию из `llmAssistant.mcp.servers`, подключается через stdio, получает список инструментов.

## Интерфейс

### `new McpClient(config: McpServerConfig)`

### `client.connect() → { tools: McpTool[] }`

Запускает процесс, устанавливает MCP-соединение, запрашивает `tools/list`.

### `client.disconnect()`

## Конфигурация

```json
{
  "llmAssistant.mcp.servers": [
    {
      "name": "filesystem",
      "command": "npx",
      "args": ["-y", "@modelcontextprotocol/server-filesystem", "/path"]
    }
  ]
}
```

## Контракты

| Ситуация | Поведение |
|----------|-----------|
| Команда не найдена | Ошибка при connect |
| Повторный disconnect | Безопасен (no-op) |
| MCP-инструменты | Префикс `mcp_` в ToolSystem |
| Ошибка выполнения MCP | Статус ОШИБКА, не роняет агента |

## Связи

- **Использует:** `@modelcontextprotocol/sdk`
- **Используется:** ChatViewProvider (чат-агент и оркестратор)

## Детали реализации

- **Транспорт:** stdio (StdioClientTransport из @modelcontextprotocol/sdk)
- **Подключение:** `client.connect(transport)` → `client.listTools()`
- **Конвертация:** MCP tools → `{type: 'function', function: {name, description, parameters}}`
- **Ошибки:** подключение — исключение; повторный disconnect — no-op


## Тесты (mcpClient.test.ts, 10 тестов)

- AC-5.1: структура McpClient, connect() с несуществующей командой выбрасывает ошибку
- AC-5.2: MCP-инструменты регистрируются в ToolSystem с префиксом mcp_
- AC-5.3: execute() MCP-инструмента возвращает результат; ошибка возвращает ОШИБКА
- AC-5.4: disconnect() безопасен; повторный disconnect() безопасен
- AC-5.5: getAllowedTools фильтрует MCP-инструменты по allow-list

## История изменений

| Версия | Дата | Изменения |
|--------|------|-----------|
| 0.8.0 | 2026-08-06 | MCP для оркестратора |
| 0.5.0 | 2026-08-05 | Базовая реализация |
