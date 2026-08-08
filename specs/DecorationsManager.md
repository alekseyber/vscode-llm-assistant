---
component: DecorationsManager
version: 0.9.0
status: planned
since: 0.9.0
---

## Назначение

Визуальная подсветка строк в редакторе после операций агента (write_file, replace_in_file). Зелёная — новые строки, жёлтая — изменённые.

## Интерфейс

### `new DecorationsManager()`

Создаёт два `TextEditorDecorationType`: `addedDecoration` (зелёный) и `modifiedDecoration` (жёлтый).

### `highlightAdded(uri: vscode.Uri, range: vscode.Range)`

Подсвечивает добавленные строки зелёным.

### `highlightModified(uri: vscode.Uri, range: vscode.Range)`

Подсвечивает изменённые строки жёлтым.

### `clearAll()`

Сбрасывает все подсветки.

### `clearForFile(uri: vscode.Uri)`

Сбрасывает подсветки для конкретного файла.

## Контракты

| Ситуация | Поведение |
|----------|-----------|
| `write_file` → highlightAdded | Зелёная подсветка строк файла |
| `replace_in_file` → highlightModified | Жёлтая подсветка изменённых строк |
| Через 5 секунд | Автосброс подсветки |
| Пользователь редактирует файл | Сброс подсветки (`onDidChangeTextDocument`) |
| Файл не открыт в редакторе | Подсветка не применяется (нет активного editor) |

## Детали реализации

- **VS Code API:** `vscode.window.createTextEditorDecorationType()`, `editor.setDecorations()`
- **addedDecoration:** `backgroundColor: new vscode.ThemeColor('diffEditor.insertedTextBackground')`, `border: '1px solid rgba(137, 209, 133, 0.5)'`
- **modifiedDecoration:** `backgroundColor: new vscode.ThemeColor('diffEditor.modifiedTextBackground')`, `border: '1px solid rgba(226, 192, 141, 0.5)'`
- **Таймер:** `setTimeout(5000)` для автосброса
- **Интеграция:** вызывается из `ChatAgentTools` после `write_file` и `replace_in_file`
- **Синглтон:** один экземпляр на всё расширение

## Тесты

- AC-4.1: highlightAdded применяет decoration к строкам
- AC-4.2: highlightModified применяет decoration
- AC-4.3: clearForFile убирает decoration
- AC-4.4: clearAll убирает все decorations

## AC

| ID | Критерий | Статус |
|----|----------|--------|
| AC-4.1 | После write_file строки подсвечиваются зелёным | planned |
| AC-4.2 | После replace_in_file строки подсвечиваются жёлтым | planned |
| AC-4.3 | Подсветка сбрасывается через 5 секунд | planned |
| AC-4.4 | Подсветка сбрасывается при ручном редактировании | planned |

## Связи

- **Использует:** VS Code Decoration API
- **Используется:** `ChatAgentTools` (write_file, replace_in_file)

## История изменений

| Версия | Дата | Изменения |
|--------|------|-----------|
| 0.9.0 | 2026-08-07 | Начальная спецификация |
