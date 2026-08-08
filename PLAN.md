# PLAN: Plan Mode (📋) — планирование + имплементация + рефлексия

**Версия:** 0.9.0
**Spec:** specs/PlanModeManager.md

---

## Этапы

### Этап 1: PlanModeManager + PlannerAgent

| AC | Критерий | Статус |
|----|----------|--------|
| PM-3 | PlannerAgent создаёт план в `.llma/plans/<uuid>-<slug>.md` | planned |
| PM-4 | План содержит все обязательные секции | planned |

**Действия:**
1. Создать `src/modes/chat/PlanModeManager.ts` — generatePlan(), implementPlan(), reflect()
2. PlannerAgent: AgentWorker с промтом планировщика, allowedTools: read_file, search_files, list_files, write_file
3. Генерация UUID + slug из названия задачи
4. Запись плана через write_file в `.llma/plans/`
5. `npm run compile` — чистая компиляция
6. `npx tsc -p tsconfig.test.json` — компиляция тестов
7. `npm run test:mocked` — все существующие тесты должны пройти
8. `npm run lint` — 0 ошибок
9. Коммит + push

**Gate 1 (верификация):**
- [ ] `npm run compile` → exit 0
- [ ] `npx tsc -p tsconfig.test.json` → exit 0
- [ ] `npm run test:mocked` → 0 failures
- [ ] `npm run lint` → exit 0
- [ ] Вызов `generatePlan("добавь кнопку в UI")` создаёт файл `.llma/plans/plan-*.md`
- [ ] Сгенерированный файл содержит секции: Затронутые компоненты, Этапы, Контрольные точки, Инструкция для ревьюера

---

### Этап 2: WebView UI — переключатель + отображение плана

| AC | Критерий | Статус |
|----|----------|--------|
| PM-1 | Переключатель «📋 Plan» над textarea только в agent-режиме | planned |
| PM-2 | Plan Mode OFF (по умолчанию) — поведение не меняется | planned |
| PM-5 | План отображается с кнопками «✅ Имплементировать» / «✏️ Исправить» | planned |
| PM-12 | «✏️ Исправить» → возврат в чат | planned |
| PM-13 | Режим не влияет на chat-режим | planned |

**Действия:**
1. `src/webviews/chat/main.js`: переключатель Plan Mode над textarea
2. `src/webviews/chat/index.html`: контейнер для плана + кнопки
3. `src/webviews/chat/styles.css`: стили
4. Обработчики сообщений: `planGenerated`, `implementPlan`, `editPlan`
5. `npm run compile && npx tsc -p tsconfig.test.json && npm run test:mocked && npm run lint`
6. Коммит + push

**Gate 2 (верификация):**
- [ ] `npm run compile` → exit 0
- [ ] `npm run test:mocked` → 0 failures
- [ ] В agent-режиме: переключатель «📋 Plan» виден над textarea
- [ ] В chat-режиме: переключатель НЕ виден
- [ ] По умолчанию переключатель OFF
- [ ] После получения `planGenerated`: план отображается, кнопки ✅ и ✏️ работают
- [ ] Кнопка «✏️» возвращает в чат

---

### Этап 3: ChatViewProvider — ветвление handleSendMessage

| AC | Критерий | Статус |
|----|----------|--------|
| PM-6 | «✅ Имплементировать» → оркестратор с чистым контекстом | planned |

**Действия:**
1. `ChatViewProvider.handleSendMessage`: проверка planMode → PlanModeManager.generatePlan()
2. Обработчик `implementPlan` → PlanModeManager.implementPlan()
3. implementPlan: AgentOrchestrator (architect → coder), задача = «Реализуй план из <path>»
4. `npm run compile && npx tsc -p tsconfig.test.json && npm run test:mocked && npm run lint`
5. Коммит + push

**Gate 3 (верификация):**
- [ ] `npm run compile` → exit 0
- [ ] `npm run test:mocked` → 0 failures
- [ ] Plan Mode ON + agent → PlannerAgent запускается, план создаётся
- [ ] Plan Mode OFF + agent → обычный ReAct (текущее поведение)
- [ ] «✅ Имплементировать» → оркестратор запускается с планом

---

### Этап 4: Имплементация — оркестратор + отметка AC

| AC | Критерий | Статус |
|----|----------|--------|
| PM-7 | Coder отмечает выполненные AC в плане (⬜ → ✅) | planned |

**Действия:**
1. Coder-промт: инструкция после каждого этапа — прочитать план и отметить AC через patch
2. План обновляется: чек-лист с выполненными пунктами
3. `npm run compile && npx tsc -p tsconfig.test.json && npm run test:mocked && npm run lint`
4. Коммит + push

**Gate 4 (верификация):**
- [ ] `npm run compile` → exit 0
- [ ] `npm run test:mocked` → 0 failures
- [ ] После имплементации: в плане есть AC со статусом ✅
- [ ] Формат отметки: `⬜` → `✅` в таблице AC

---

### Этап 5: Рефлексия — ReviewerAgent + цикл исправлений

| AC | Критерий | Статус |
|----|----------|--------|
| PM-8 | ReviewerAgent проверяет результат по плану | planned |
| PM-9 | Reviewer докладывает: ✅ AC-1 / ❌ AC-2 (детали) | planned |
| PM-10 | При ❌ — coder исправляет, reviewer перепроверяет (макс. 2 цикла) | planned |
| PM-11 | Все ✅ → финальный отчёт | planned |

**Действия:**
1. ReviewerAgent: AgentWorker с промтом ревьюера
2. Цикл: reviewer → при ❌ → coder fixes → reviewer re-check (макс. 2 полных цикла)
3. Финальный отчёт в UI («ПЛАН ВЫПОЛНЕН ПОЛНОСТЬЮ» или список невыполненных AC)
4. `npm run compile && npx tsc -p tsconfig.test.json && npm run test:mocked && npm run lint`
5. Коммит + push

**Gate 5 (верификация):**
- [ ] `npm run compile` → exit 0
- [ ] `npm run test:mocked` → 0 failures
- [ ] ReviewerAgent читает план и проверяет каждый AC
- [ ] Отчёт содержит строки `✅ AC-N: ...` и/или `❌ AC-N: ...`
- [ ] При ❌: coder получает задачу «исправь замечания ревьюера», reviewer перепроверяет
- [ ] После 2 циклов с ❌ — стоп, финальный отчёт с невыполненными AC
- [ ] Все ✅ → «ПЛАН ВЫПОЛНЕН ПОЛНОСТЬЮ»

---

### Этап 6: Приёмка

| AC | Критерий | Статус |
|----|----------|--------|
| - | Все 13 AC → ✅ | planned |
| - | 244+ тестов зелёные | planned |
| - | CHANGELOG обновлён | planned |
| - | Ручное тестирование по MANUAL_TEST_SCENARIOS | planned |

**Действия:**
1. Обновить все AC в specs/PlanMode.md (planned → ✅)
2. CHANGELOG.md: версия 0.9.0
3. Бамп версии в package.json
4. Финальный: `npm run compile && npm run test:mocked && npm run lint`
5. `git add -A && git commit -m "...план" && git push`
6. Сборка VSIX
7. Ручное тестирование сценария: Plan Mode ON → задача → план → имплементировать → рефлексия

---

## Затронутые файлы

| Файл | Изменение |
|------|-----------|
| `src/modes/chat/PlanModeManager.ts` | **Новый:** generatePlan, implementPlan, reflect |
| `src/modes/chat/ChatViewProvider.ts` | Ветвление handleSendMessage |
| `src/webviews/chat/main.js` | Переключатель + отображение плана + кнопки |
| `src/webviews/chat/index.html` | Элементы UI |
| `src/webviews/chat/styles.css` | Стили |
| `specs/PlanModeManager.md` | **Новый:** полная спецификация |
| `specs/ChatViewProvider.md` | Обновлён: контракты Plan Mode |
