---
component: ToolAllowList
version: 0.8.0
status: stable
since: 0.4.0
---

## Назначение

Фильтрация инструментов по списку разрешённых. Загружает конфигурацию из `.vscode/llm-assistant.json` (приоритет) или глобальных настроек VS Code.

## Интерфейс

### `loadToolAllowListConfig() → ToolAllowListConfig`

### `getAllowedTools<T>(allTools, config) → T[]`

Фильтрует инструменты по `allowedTools`. Если не задан — все разрешены.

### `isConfirmationRequired(toolName, config) → boolean`

Проверяет, требует ли инструмент подтверждения (по `requireConfirmation`).

## Конфигурация

```json
// .vscode/llm-assistant.json
{
  "allowedTools": ["read_file", "search_files"],
  "requireConfirmation": ["write_file", "run_terminal"]
}
```

## Контракты

| Ситуация | Поведение |
|----------|-----------|
| `allowedTools` не задан | Все инструменты доступны |
| `allowedTools` = ["read_file"] | Только read_file |
| `requireConfirmation` = [...] | Указанные инструменты требуют подтверждения |
| `.vscode/llm-assistant.json` не найден | Fallback на глобальные настройки |
| Невалидный JSON | Fallback на глобальные |
| Нет workspace | Глобальные настройки |

## Default: `write_file`, `replace_in_file`, `run_terminal` требуют подтверждения.

## Связи

- **Используется:** ChatAgentTools, AgentController
- **Источники:** `.vscode/llm-assistant.json` > `llmAssistant.apply.*`

## Детали реализации

- **Workspace:** `.vscode/llm-assistant.json` → `JSON.parse` → валидация
- **Глобальный:** `llmAssistant.apply.allowedTools/requireConfirmation`
- **Приоритет:** workspace > глобальные > DEFAULT_CONFIG
- **DEFAULT_CONFIG:** `requireConfirmation: ['write_file', 'replace_in_file', 'run_terminal']`


## История изменений

| Версия | Дата | Изменения |
|--------|------|-----------|
| 0.4.0 | 2026-08-05 | Базовая реализация |
