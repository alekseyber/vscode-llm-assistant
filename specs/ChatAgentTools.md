---
component: ChatAgentTools
version: 0.8.21
status: stable
since: 0.1.0
---

## Назначение

Реестр инструментов для агентного режима. Предоставляет функцию `getToolSchemas()` для OpenAI function calling и `getTool()` для выполнения.

## Инструменты

| Имя | Описание | Параметры | Подтверждение |
|-----|----------|-----------|---------------|
| `read_file` | Чтение файла с нумерацией строк | `path`, `offset?`, `limit?` | Нет |
| `write_file` | Запись файла (перезапись) | `path`, `content` | Да |
| `replace_in_file` | Замена текста в файле | `path`, `old_str`, `new_str` | Да |
| `list_files` | Список файлов/папок | `path?`, `depth?` | Нет |
| `search_files` | Поиск по regex | `pattern`, `path?`, `file_glob?` | Нет |
| `run_terminal` | Выполнение команды | `command`, `timeout?` | Да |
| `delegate_to_agent` | Делегирует задачу другому агенту | `role`, `task` | Нет |
| `web_fetch` | Читает веб-страницу. Возвращает текст (≤15000) | `url`, `selector?` | Да |
| `ask_user` | Задать уточняющий вопрос пользователю | `question`, `options?` | Нет |

## Контракты

| Ситуация | Поведение |
|----------|-----------|
|| `delegate_to_agent` без handler | Ошибка «делегирование не настроено» |
|| role не найден в .llma/agents/ | Синтетическая роль |
|| `ask_user` с options | QuickPick с вариантами + «Пропустить» |
|| `ask_user` без options | InputBox с открытым вводом |
|| Пользователь закрыл/Escape | Возвращает «(пропущено)» |
| Файлы с префиксом \d{2}- | В цепочку @orchestrate |
| Файлы без префикса | Только для delegate_to_agent |

## Интерфейс

### `getToolSchemas() → ToolSchema[]`

Схемы в формате OpenAI function calling, отфильтрованные по allow-list.

### `getTool(name) → ChatTool | undefined`

Поиск инструмента по имени (только если он в allow-list).

## Фильтрация (Allow-list)

Через `.vscode/llm-assistant.json`:

```json
{
  "allowedTools": ["read_file", "search_files"],
  "requireConfirmation": ["write_file", "run_terminal"]
}
```

## Контракты

| Ситуация | Поведение |
|----------|-----------|
| allow-list пуст | Все инструменты доступны |
| Инструмент не в allow-list | `getTool()` → `undefined` |
| `write_file` без allow-list | Требует подтверждения по умолчанию |

## Связи

- **Используется:** `AgentWorker`, `AgentOrchestrator`
- **Зависит от:** `ToolAllowList`, `AskUserTool`

## AC

| ID | Критерий | Статус |
|----|----------|--------|
|| AC-4.1 | allowedTools фильтрует инструменты | ✅ |
|| AC-4.2 | Без allowedTools — все доступны | ✅ |
|| AC-4.4 | write_file из requireConfirmation требует подтверждения | ✅ |
||  — | read_file, search_files, list_files возвращают результат | ✅ |
||  — | write_file, replace_in_file записывают через VS Code API | ✅ |
||  — | run_terminal выполняет команду с timeout | ✅ |
|| AC-1.5 | ask_user доступен в списке инструментов | ✅ |

## Детали реализации

- **VS Code API:** `vscode.workspace.fs.readFile/writeFile`, `vscode.Uri.file()`
- **read_file:** нумерация строк (4-значный pad), 1-indexed
- **write_file:** `createDirectory` для автосоздания папок
- **replace_in_file:** только первое вхождение (не replaceAll)
- **list_files:** рекурсивно, папки сверху, исключение `.*` и `node_modules`
- **search_files:** `findFiles` с RelativePattern, лимит 200/100
- **run_terminal:** `child_process.exec`, timeout сек->мс, maxBuffer 1MB


## Тесты

Тестируется через AgentWorker и ToolAllowList тесты.
Прямые тесты: фильтрация через getAllowedTools, выполнение в мок-контексте.

## История изменений

| Версия | Дата | Изменения |
|--------|------|-----------|
| 0.8.0 | 2026-08-06 | Без изменений |
| 0.1.0 | 2026-08-04 | Базовая реализация: 6 инструментов |
