---
component: ToolDefinitions
version: 0.8.0
status: stable
since: 0.1.0
---

## Назначение

Определения 5 инструментов для Apply Mode (AgentController + ToolSystem). Аналог ChatAgentTools, но с JSON Schema и интерфейсом `Tool`.

## Инструменты

| Имя | Параметры |
|-----|-----------|
| `read_file` | path, offset?, limit? |
| `write_file` | path, content |
| `patch_file` | path, old, new, replace_all? |
| `search_files` | pattern, path?, file_glob? |
| `run_terminal` | command, workdir?, timeout? |

### `createTools() → Tool[]`

## Отличия от ChatAgentTools

| ChatAgentTools | ToolDefinitions |
|----------------|-----------------|
| 6 инструментов (list_files) | 5 инструментов (patch_file вместо replace_in_file) |
| Интерфейс ChatTool | Интерфейс Tool |
| Для чат-агента (AgentWorker) | Для Apply Mode (AgentController) |

## Связи

- **Используется:** AgentController (через ToolSystem)
- **Дублирует:** ChatAgentTools (разные реестры инструментов — техдолг)

## История изменений

| Версия | Дата | Изменения |
|--------|------|-----------|
| 0.1.0 | 2026-08-04 | Базовая реализация |
