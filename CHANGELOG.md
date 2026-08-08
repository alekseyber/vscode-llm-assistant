# Changelog

## 0.9.0 (2026-08-08)

- **Plan Mode:** режим планирования для Agent Mode — план → имплементация → рефлексия (PM-1..PM-13)
- PlannerAgent: изолированный агент-планировщик, создаёт план в `.llma/plans/`
- ReviewerAgent: агент-рефлексии, проверяет реализацию по плану (макс. 2 цикла)
- PlanModeManager: оркестрирует 3 этапа (generatePlan → implementPlan → reflect)
- WebView: переключатель «📋 Plan» над textarea, отображение плана, кнопки ✅/✏️

## 0.8.22 (2026-08-08)

- AgentWorker: очистка инжекта ⚠️ после выполнения ask_user (MA-1.11)

## 0.8.21 (2026-08-08)

- Удаление последней сессии: UI-блокировка снята, автосоздаётся новая пустая

## 0.8.20 (2026-08-08)

- SessionManager: удаление последней сессии → автосоздание новой

## 0.8.19 (2026-08-08)

- Фикс `[object Object]` в model-select: извлечение `.name` из объектов `{name, pricing}`
- Токены оркестратора в индикатор (было 0+0)

## 0.8.18 (2026-08-08)

- Фикс `[object Object]` в модели: извлечение `.name` из ModelConfig в handleSendMessage
- Токены оркестратора в индикатор: postMessage type='tokens' после оркестрации

## 0.8.17 (2026-08-08)

- Модель pricing: пользователь указывает цены через `{name, pricing}` в models
- Откат хардкода цен из FALLBACK_PRICING

## 0.8.16 (2026-08-08)

- FALLBACK_PRICING: добавлена `deepseek-ai/DeepSeek-V4-Flash-0731`

## 0.8.15 (2026-08-08)

- ask_user: ответы с пометкой `[ВОПРОС ЗАКРЫТ]`, запрет на повтор вопросов

## 0.8.14 (2026-08-08)

- Запрет «что дальше?» после выполнения — ask_user только для уточнения задачи

## 0.8.13 (2026-08-08)

- Запрет на уточняющие вопросы без явной просьбы пользователя

## 0.8.12 (2026-08-08)

- ask_user: авто-определение Да/Нет по ключевым словам (нужно, надо, стоит…)
- Фикс `\b` → `(?:^|\s)` для кириллицы (JS `\b` не работает с русскими буквами)

## 0.8.11 (2026-08-08)

- ask_user: авто-Да/Нет в system-сообщении при триггер-словах

## 0.8.10 (2026-08-08)

- Принудительный ask_user: system-сообщение при «спроси», «уточни», «предложи варианты»

## 0.8.9 (2026-08-08)

- Расширены триггеры ask_user: «спроси», «задай вопрос», «выясни»

## 0.8.8 (2026-08-08)

- ask_user description: явное указание НЕ придумывать options

## 0.8.7 (2026-08-08)

- ask_user без options: InputBox напрямую с `ignoreFocusOut` (убрана промежуточная модалка)

## 0.8.6 (2026-08-08)

- ask_user: модальные окна `showInformationMessage` вместо InputBox
- Description с явным указанием передавать options

## 0.8.5 (2026-08-08)

- Жёсткий промпт: принудительный вызов ask_user/web_fetch вместо текстовых ответов

## 0.8.4 (2026-08-08)

- Фикс системного промпта: все 9 инструментов в списке (было только 5)
- ask_user: QuickPick/InputBox/showInformationMessage

## 0.8.3 (2026-08-08)

- web_fetch: чтение веб-страниц (HTML→текст, ≤15000, CSS-селектор)
- WF-1/WF-2: web_fetch в ChatAgentTools и ToolDefinitions

## 0.8.2 (2026-08-07)

- Индикатор токенов в шапке чата (токены + стоимость + прогресс-бар)
- Сброс индикатора при смене сессии

## 0.8.1 (2026-08-07)

- MA-6: delegate_to_agent — делегирование подзадач между агентами
- MA-7: cost tracking per agent — WorkerResult.cost, totalCost, сводка
- Префиксы агентов: `\d{2}-` → цепочка, без префикса → делегирование
- loadAllAgentRoles() — все роли для делегирования
- recordChatRun в handleOrchestrate — стоимость в истории
- delegate maxIterations: 5 → 15

## 0.8.0 (2026-08-06)

- AgentWorker — общий ReAct-движок для чат-агента и оркестратора
- Динамические роли @orchestrate: .llma/agents/*.md, порядок по префиксу
- MCP для оркестратора: extraTools через AgentOrchestrator
- Cost tracking: ModelEntry = string | {name, pricing}, calculateCost()
- Реальные токены: usage.prompt_tokens/completion_tokens из API
- CI: spec-validate как отдельный job

## 0.7.0 (2026-08-05)

- Multi-agent harness: AgentWorker, AgentOrchestrator, SharedContext
- OrchestratorViewProvider — вкладка «🎭 Оркестратор»
- Role-based AGENTS.md: .llma/agents/{role}.md
- Команда @orchestrate в чате

## 0.1.0 (2026-08-04)

- Инициализация проекта
- Базовая архитектура: 4 режима (chat, edit, autocomplete, apply)
- Provider Manager с OpenAI-совместимыми провайдерами
