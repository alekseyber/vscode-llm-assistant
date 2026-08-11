# Release Notes — v0.9.0

## 📋 Plan Mode

- **Три этапа:** планирование (PlannerAgent) → имплементация (architect → coder) → рефлексия (ReviewerAgent)
- Переключатель «📋 Plan» над textarea (только для Agent-режима)
- Автоматическая генерация плана в `.llma/plans/plan_YYYY-MM-DD_UUID.md`
- Кнопки «✅ Имплементировать» / «✏️ Исправить»
- Циклы рефлексии: reviewer проверяет AC, coder исправляет замечания (макс. 2 цикла)
- Поддержка AbortSignal для отмены на всех этапах
- Кнопка отправки ➤↔⏹️ — отмена ReAct одним кликом

## 🗂 Каталог скилов (.llma/skills/)

- Агент видит доступные скилы в system prompt (имя + description)
- `parseFrontmatter()`: парсинг YAML frontmatter (`name`, `version`, `tools`, `description`)
- `getSkillCatalog()`: сканирование `.llma/skills/` → таблица
- `getSkillTemplate()`: системный шаблон структуры скила
- **`/skill` команда:** `/coder задача` — инжект содержимого скила как system-сообщение
- Поддержка `role` в frontmatter для обратной совместимости

## 🛠 Инструменты

- `getToolSchemasUnfiltered()` / `getToolUnfiltered()` — схемы без глобального allow-list
- `skipGlobalAllowList` — Plan Mode и оркестратор обходят allow-list, фильтруя через `role.allowedTools`
- `AgentWorkerOptions.signal` — AbortSignal для отмены
- `AgentOrchestrator.workerOptions` — проброс опций во все AgentWorker

## 🐛 Исправления

- Регекс `AC-\d+\s*❌|❌\s*AC-` — поддержка обоих форматов отчёта ревьюера
- Slug имени плана: первые 3 слова → `YYYY-MM-DD_shortUUID`
- Реальная дата в плане вместо 2025-01-01
- `allPassed` не срабатывает ложно на fallback-сообщении
- Подчёркивание плана как ссылки исправлено (GFM off + pointer-events none)
