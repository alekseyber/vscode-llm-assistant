---
component: AgentsMdLoader
version: 0.8.0
status: stable
since: 0.1.0
---

## Назначение

Загрузка правил главного агента из `.llma/main.md`. Кеширует содержимое, инвалидирует при изменении файла.

## Интерфейс

### `loadAgentsMd() → Promise<string | null>`

Читает `.llma/main.md` из корня workspace. Кеширует результат.

### `invalidateCache()`

Сбрасывает кеш вручную.

## Контракты

| Ситуация | Поведение |
|----------|-----------|
| Файл существует | Возвращает содержимое |
| Файла нет | null |
| `agentsMd.enabled: false` | null |
| Файл изменён | Авто-инвалидация кеша |
| Нет workspace | null |

## Связи

- **Используется:** ChatViewProvider (getSystemPrompt), ConversationManager (getMessagesForRequest), AgentController
- **Файл:** `.llma/main.md`

## История изменений

| Версия | Дата | Изменения |
|--------|------|-----------|
| 0.1.0 | 2026-08-04 | Базовая реализация |
