---
component: RoleAgentsMdLoader
version: 0.8.0
status: stable
since: 0.7.0
---

## Назначение

Загрузка правил для ролевых воркеров из `.llma/` директории. Сканирование ролей для `@orchestrate`.

## Файловая структура

```
project/
  .llma/
    main.md                    # ← главные правила (fallback)
    agents/
      architect.md             # ← роль architect
      01-architect.md          # ← роль с префиксом порядка
      02-coder.md
      03-reviewer.md
      tester.md                # ← дополнительная роль
```

## Интерфейс

### `loadRoleAgentsMd(roleName) → string | null`

Приоритет: `.llma/agents/{role}.md` → `.llma/main.md` → `null`.

Результат кешируется. `invalidateRoleCache()` сбрасывает кеш.

### `loadOrchestratorRoles() → AgentRole[]`

Сканирует `.llma/agents/*.md`, сортирует по имени файла.

| Ситуация | Результат |
|----------|-----------|
| `.llma/agents/` не существует | Fallback: architect, coder, reviewer |
| Пустая директория | Fallback |
| Есть `.md` файлы | По одному `AgentRole` на файл |
| Пустой файл | `systemPrompt = "Ты — {roleName}. Отвечай кратко, по-русски."` |

### Имя роли

Из имени файла без `.md`: `01-architect.md` → роль `01-architect`.

## Контракты

| Ситуация | Поведение |
|----------|-----------|
| Ролевой файл существует | Возвращается содержимое |
| Ролевого файла нет | Fallback на `main.md` |
| `main.md` нет | `null` |
| Нет workspace | `null` / fallback-роли |
| Повторный вызов | Из кеша |

## Связи

- **Используется:** `AgentWorker.run()`, `ChatViewProvider.handleOrchestrate()`

## AC

| ID | Критерий | Статус |
|----|----------|--------|
| MA-5.1 | `AGENTS.{role}.md` загружается для роли | ✅ |
| MA-5.2 | Fallback на `main.md` если ролевого нет | ✅ |
|  — | `loadOrchestratorRoles()` сканирует `.llma/agents/*.md` | ✅ |
|  — | Порядок ролей определяется алфавитной сортировкой имён | ✅ |
|  — | Fallback-роли при отсутствии директории | ✅ |

## Детали реализации

- **Кеш:** `Map<string, string|null>`, ключ `role:{roleName}`
- **Приоритет:** `.llma/agents/{role}.md` → `.llma/main.md` → null
- **Оркестратор:** `fs.readdirSync()` → `.md` фильтр → сортировка
- **Имя роли:** `fileName.replace(/\.md$/, '')` (сохраняет префикс)
- **SystemPrompt:** содержимое файла, fallback `"Ты — {roleName}..."`


## История изменений

| Версия | Дата | Изменения |
|--------|------|-----------|
| 0.8.0 | 2026-08-06 | `loadOrchestratorRoles()` — динамические роли |
| 0.7.0 | 2026-08-05 | `loadRoleAgentsMd()` |
