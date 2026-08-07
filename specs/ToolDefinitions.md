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

## Детали реализации

- **VS Code API:** `vscode.workspace.fs` + `child_process.exec`
- **read_file:** offset/limit 1-indexed, `padStart(4)`
- **patch_file:** подсчёт вхождений через `split().length-1`
- **search_files:** `findFiles`, исключение node_modules, лимит 500/200
- **run_terminal:** `exec` с timeout, maxBuffer 10MB


## История изменений

| Версия | Дата | Изменения |
|--------|------|-----------|
| 0.1.0 | 2026-08-04 | Базовая реализация |
