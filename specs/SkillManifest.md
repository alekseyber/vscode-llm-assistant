---
component: SkillManifest
version: 0.1.3
status: beta
since: 0.23.3
---

## Назначение

Проверка манифеста скилла: frontmatter и структура. Скилл — инструкция агенту, и правка `.md`
меняет его поведение молча; проверка делает правку видимой в диффе (имя, описание, версия,
дата, размер) и не даёт завести два скилла с одним именем.

## Интерфейс

```ts
validateSkillContent(content: string, filePath?: string): SkillManifestResult;
validateChangedSkill(filePath: string, before: string, after: string): string[];
parseSkillFrontmatter(content: string): Record<string, string>;
findDuplicateNames(skills: Array<{ name: string; filePath: string }>): string[];
```

`SkillManifestResult` — `{ name, description, version?, updated?, errors[] }`.

## Контракты

- `name` и `description` обязательны: без них скилл не попадает в каталог агента.
- `name` — одно слово (пробелы запрещены).
- `version` — если указана, формат `x.y.z`; `updated` — `YYYY-MM-DD`. Необязательны, чтобы
  не заводить второй формат вопреки P7 (совместимость с `SKILL.md`).
- Файл больше 256 КБ отклоняется.
- Дубли имён ловятся без учёта регистра; приоритет `.llma` над `.claude` — в загрузчике,
  а проверка сообщает о самом факте дубля.

## Тесты

`test/suite/skillManifest.test.ts` — `SKM-1..10`: годный манифест, отсутствие имени и описания,
имя с пробелами, неверные форматы версии и даты, лимит размера, дубли, опциональность полей,
парсинг с кавычками и CRLF.

## Связи

- `scripts/check-skills.js` — CLI для CI: обходит `.llma/skills/*.md` и `.claude/skills/*/SKILL.md`;
- `RoleAgentsMdLoader` — читает те же файлы в рантайме;
- CI: шаг «Проверка скиллов» в job `test-unit` (после `tsc`, нужен скомпилированный модуль).

## История изменений

| Версия | Дата | Изменения |
|--------|------|-----------|
| 0.1.3 | 2026-11-12 | Пустое тело (только frontmatter или пробелы) — ошибка: файл без инструкций бесполезен. CLI обходит `.claude/skills` до трёх уровней. BOM в начале файла снимается перед разбором — иначе якорь `^---` не срабатывал и манифест «не находился». Тесты `SKM-16..17`; мутации гейта `SKM-NO-DUPLICATES`, `SKM-NO-SIZE`, `SKM-NO-NAME-PATH` |
| 0.1.2 | 2026-11-12 | `validateChangedSkill`: изменённый файл скилла обязан менять `version` или `updated`. CLI-флаг `--since <ref>`: CI берёт `github.event.before` (коммит до пуша), иначе `origin/main`; новый файл не считается правкой без отметки, удаление попадает в лог; ошибка git — код 2; тесты `SKM-13..15` |
| 0.1.1 | 2026-11-12 | Правки ревью: общий лимит вынесен в `src/shared/skillLimits.ts` (модуль без зависимостей, чтобы CLI не тянул `vscode`); проверка совпадения `name` с именем файла/каталога; многострочный и вложенный frontmatter отклоняется явной ошибкой, а не разбирается молча; тесты `SKM-11..12` |
| 0.1.0 | 2026-11-12 | Первая версия: проверка frontmatter, форматов, размера и дублей; `SKM-1..10` |
