# PLAN: v0.9.0 — Plan Mode + Каталог скилов

**Версия:** 0.9.0
**Specs:** specs/PlanModeManager.md, specs/RoleAgentsMdLoader.md

---

## Часть A: Plan Mode (📋) — ✅ реализовано

| Этап | Статус |
|------|--------|
| A1: PlanModeManager + PlannerAgent | ✅ |
| A2: WebView UI | ✅ |
| A3: ChatViewProvider ветвление | ✅ |
| A4: Coder отмечает AC | ✅ |
| A5: ReviewerAgent + рефлексия | ✅ |
| A6: Приёмка, CHANGELOG | ✅ |

**Осталось:** ручное тестирование (MANUAL_TEST_SCENARIOS_PLAN_MODE.md).

---

## Часть B: Каталог скилов

### Этап B1: parseFrontmatter() + getSkillCatalog()

| AC | Критерий | Статус |
|----|----------|--------|
| SC-1 | `getSkillCatalog()` сканирует `.llma/agents/` → `[{name, description}]` | planned |
| SC-2 | `parseFrontmatter()` извлекает `role` и `description` из YAML между `---` | planned |
| SC-3 | Без frontmatter: `name = имя_файла`, `description = первые 80 символов` | planned |
| SC-4 | Допустимые поля frontmatter: `role`, `version`, `tools`, `description` | planned |

**Действия:**
1. `src/shared/RoleAgentsMdLoader.ts`:
   - `parseFrontmatter(content)` — парсинг между `---`, допустимые ключи
   - `getSkillCatalog(workspacePath)` — `readdirSync` + `parseFrontmatter` + fallback
   - Обновить `getSkillTemplate(workspacePath?)` — добавить секцию каталога
2. `npm run compile && npx tsc -p tsconfig.test.json && npm run test:mocked && npm run lint`
3. Коммит + push

**Gate B1:**
- [ ] `npm run compile` → exit 0
- [ ] `npm run test:mocked` → 0 failures
- [ ] `parseFrontmatter('---\nrole: coder\ndescription: Dev\n---')` → `{role:'coder', description:'Dev'}`
- [ ] `getSkillCatalog()` с 2 .md файлами → массив из 2 SkillInfo
- [ ] Файл без frontmatter → fallback (имя файла + первые 80 символов)

---

### Этап B2: Инжект каталога в system prompt

| AC | Критерий | Статус |
|----|----------|--------|
| SC-5 | `getSkillTemplate()` добавляет секцию «Доступные скилы» в формате таблицы `| имя | description |` | planned |
| SC-6 | Пустая директория `.llma/agents/` → секция не добавляется | planned |

**Действия:**
1. `src/modes/apply/AgentWorker.ts`: `getSkillTemplate()` вызывается с workspace path
2. Проверка: system prompt содержит таблицу скилов
3. `npm run compile && npm run test:mocked && npm run lint`
4. Коммит + push

**Gate B2:**
- [ ] `npm run compile` → exit 0
- [ ] `npm run test:mocked` → 0 failures
- [ ] System prompt содержит `## Доступные скилы` с таблицей
- [ ] Без файлов в agents/ → секция отсутствует

---

### Этап B3: Тесты + приёмка

| AC | Критерий | Статус |
|----|----------|--------|
| SC-7 | Unit-тест: `parseFrontmatter()` — валидный, пустой, без description | planned |
| SC-8 | Unit-тест: `getSkillCatalog()` с 2 файлами | planned |
| SC-9 | Unit-тест: `getSkillCatalog()` без frontmatter (fallback) | planned |
| SC-10 | Все тесты (244+) зелёные | planned |
| SC-11 | CHANGELOG обновлён | planned |

**Действия:**
1. `test/suite/roleAgentsMd.test.ts`: добавить 3 теста
2. `npm run compile && npx tsc -p tsconfig.test.json && npm run test:mocked && npm run lint`
3. CHANGELOG.md: версия 0.9.0
4. `git add -A && git commit -m "каталог скилов: parseFrontmatter + getSkillCatalog + инжект в промт" && git push`

---

## Затронутые файлы

| Файл | Часть | Изменение |
|------|-------|-----------|
| `src/shared/RoleAgentsMdLoader.ts` | B | +`parseFrontmatter`, +`getSkillCatalog`, `getSkillTemplate` принимает workspace |
| `src/modes/apply/AgentWorker.ts` | B | Передача workspace в `getSkillTemplate()` |
| `specs/RoleAgentsMdLoader.md` | B | Обновлён: интерфейс, контракты, AC, детали |
| `test/suite/roleAgentsMd.test.ts` | B | +3 теста |
