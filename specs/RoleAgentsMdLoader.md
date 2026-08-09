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

### `getSkillCatalog(workspacePath) → SkillInfo[]`

Сканирует `.llma/agents/`, парсит frontmatter.

```typescript
interface SkillInfo {
  name: string;        // имя роли (из frontmatter role или имя файла)
  description: string; // из frontmatter description или первые 80 символов контента
}
```

### `getSkillTemplate(workspacePath?) → string`

Возвращает системный шаблон структуры скила. Если передан `workspacePath` — добавляет таблицу доступных скилов из `getSkillCatalog()`.

### `parseFrontmatter(content) → Record<string, string>`

Парсит YAML-подобный frontmatter между `---`. Допустимые ключи: `role`, `version`, `tools`, `description`.

## Контракты

| Ситуация | Поведение |
|----------|-----------|
| Ролевой файл существует | Возвращается содержимое |
| Ролевого файла нет | Fallback на `main.md` |
| `main.md` нет | `null` |
| Нет workspace | `null` / fallback-роли |
| Повторный вызов | Из кеша |
| `getSkillCatalog()` — есть файлы с frontmatter | Массив `[{name, description}]` |
| `getSkillCatalog()` — файл без frontmatter | `name = имя_файла`, `description = первые 80 символов` |
| `getSkillCatalog()` — пустая директория | Пустой массив `[]` |
| `getSkillTemplate()` с workspace | Шаблон + таблица скилов из каталога |
| `getSkillTemplate()` без workspace | Только шаблон структуры скила |

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
| SC-1 | `getSkillCatalog()` сканирует `.llma/agents/` и возвращает `[{name, description}]` | ✅ |
| SC-2 | `parseFrontmatter()` извлекает `role` и `description` из YAML между `---` | ✅ |
| SC-3 | Без frontmatter: `name = имя_файла`, `description = первые 80 символов` | ✅ |
| SC-4 | Допустимые поля frontmatter: `role`, `version`, `tools`, `description` | ✅ |
| SC-5 | `getSkillTemplate()` добавляет секцию «Доступные скилы» в формате таблицы | ✅ |
| SC-6 | Пустая директория `.llma/agents/` → секция не добавляется | ✅ |

## Детали реализации

- **Кеш:** `Map<string, string|null>`, ключ `role:{roleName}`
- **Приоритет:** `.llma/agents/{role}.md` → `.llma/main.md` → null
- **Оркестратор:** `fs.readdirSync()` → `.md` фильтр → сортировка
- **Имя роли:** `fileName.replace(/\.md$/, '')` (сохраняет префикс)
- **SystemPrompt:** содержимое файла, fallback `"Ты — {roleName}..."`
- **SKILL_TEMPLATE:** системный шаблон структуры скила — инжектится в промт каждого агента через `getSkillTemplate()`. Содержит обязательные секции: frontmatter (role, version, tools, description), Описание, Задача, Правила, Запрещено.
- **getSkillCatalog():** сканирует `.llma/agents/`, парсит frontmatter каждого `.md` файла, возвращает `[{name, description}]`. Используется для построения каталога в system prompt.
- **parseFrontmatter():** извлекает YAML-подобный frontmatter между `---`. Допустимые поля: `role`, `version`, `tools`, `description`. Остальное игнорируется.
- **Fallback без frontmatter:** `name = имя_файла`, `description = content.slice(0, 80).trim()`
- **Каталог в промте:** формат `| имя | description |`. Если скилов нет — секция не добавляется.
- **Размер:** ~200 токенов на 10 скилов


## Тесты (roleAgentsMd.test.ts, 8 тестов)

- MA-5.1: AGENTS.{role}.md загружается для роли
- MA-5.2: fallback на main.md если ролевого нет; null если нет файлов
- Разные роли — разные файлы
- Кеш: повторный вызов не читает файл; invalidateRoleCache сбрасывает
- Пустой файл → fallback; нет workspace → null
- .llma/agents/{role}.md приоритет над AGENTS.{role}.md

## История изменений

| Версия | Дата | Изменения |
|--------|------|-----------|
| 0.9.0 | 2026-08-08 | SKILL_TEMPLATE, getSkillCatalog, parseFrontmatter — каталог скилов |
| 0.7.0 | 2026-08-05 | `loadRoleAgentsMd()` |
