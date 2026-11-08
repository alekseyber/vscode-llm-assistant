---
component: ToolDefinitions
version: 0.14.29
status: stable
since: 0.1.0
---

## Назначение

Определения 5 инструментов для Apply Mode (AgentController + ToolSystem). Аналог ChatAgentTools, но с JSON Schema и интерфейсом `Tool`.

## Интерфейс

### `createTools() → Tool[]`

Возвращает массив из 5 инструментов: read_file, write_file, patch_file, search_files, run_terminal.

## Инструменты

| Имя | Параметры |
|-----|-----------|
| `read_file` | path, offset?, limit? |
| `write_file` | path, content |
| `patch_file` | path, old, new, replace_all? |
| `search_files` | pattern, path?, file_glob? |
| `run_terminal` | command, workdir?, timeout? |

### `createTools() → Tool[]`

## Контракты

| Ситуация | Поведение |
|----------|-----------|
| read_file | Нумерация строк (4-значный pad), 1-indexed |
| write_file | Автосоздание папок через createDirectory |
| search_files | Просматривает до 5000 файлов (было 500), пропускает `node_modules`, `.git`, `dist`, `out`, `build`, `coverage`, `.next`, `vendor`, `.vscode-test`; файлы из `.gitignore` исключаются (SF-1..SF-4) |
| search_files | Ранжирование: объявления символов (`function`, `class`, `interface`, `const`, `def` и т.п.) выше обычных вхождений, совпадение в имени файла добавляет вес, комментарии — ниже; модели отдаётся топ-60 |
| search_files | Файлы больше 1 МБ не читаются (минифицированный код, артефакты) |
| write_file | Содержимое совпадает с файлом → не перезаписывает, отвечает «Файл не изменён» (идемпотентность, WF-1..3) |
| patch_file | Подсчёт вхождений через split().length-1 |
| search_files | Лимит 500 файлов, 200 совпадений |
| run_terminal | exec с timeout (сек→мс), maxBuffer 10MB |

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


## Тесты

Тестируется через ToolSystem тесты. Инструменты регистрируются через createTools() → ToolSystem.registerAll().

## История изменений

| Версия | Дата | Изменения |
|--------|------|-----------|
| 0.14.29 | 2026-11-08 | `web_fetch` оборачивает результат через `wrapExternalContent` (внешние данные не должны читаться как инструкции) |
| 0.14.28 | 2026-11-08 | `search_files`: потолок 500 → 5000 файлов, исключения каталогов и `.gitignore`, ранжирование совпадений (P8a); тесты SF-1..SF-4 |
| 0.14.12 | 2026-11-08 | `write_file` идемпотентен: та же запись не считается изменением; тесты WF-1..3 |
| 0.1.0 | 2026-08-04 | Базовая реализация |
