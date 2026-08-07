---
component: SessionManager
version: 0.8.0
status: stable
since: 0.1.0
---

## Назначение

Управление сессиями чата: создание, переключение, удаление, переименование. Хранение в `vscode.Memento` (workspaceState) — переживает перезагрузки VS Code.

## Интерфейс

### `new SessionManager(storage: Memento)`

### `listSessions() → SessionMeta[]`

### `getActive() → Session | undefined`

### `getMessages() → ChatMessage[]` — сообщения активной сессии

### `addMessage(message)` — FIFO 100 сообщений

### `switchTo(id)` / `createSession(name?) → id` / `deleteSession(id) → boolean`

### `renameSession(id, name)` / `autoNameSession(id)` / `clearActive()`

## Контракты

| Ситуация | Поведение |
|----------|-----------|
| Нет сессий при старте | Автосоздание «Сессия 1» |
| Удаление последней сессии | Запрещено (sessions.size ≤ 1) |
| Удаление активной сессии | Переключение на последнюю оставшуюся |
| ID коллизия | `crypto.randomUUID()` — гарантирует уникальность |
| >100 сообщений | slice(-100) — старые вытесняются |
| Ошибка загрузки из storage | Сброс, создание новой сессии |
| Первое сообщение → авто-имя | Первые 30 символов + «...» |

## Связи

- **Использует:** `vscode.Memento`
- **Используется:** `ConversationManager`

## Детали реализации

- **ID:** `session_${crypto.randomUUID()}` — гарантирует уникальность
- **FIFO:** максимум 100 сообщений, старые вытесняются `slice(-100)`
- **Хранение:** два ключа в workspaceState — `llmAssistant.chat.sessions` ({id: Session}) и `llmAssistant.chat.activeSession` (id)
- **Сортировка:** `listSessions()` — по lastActiveAt (новые сверху)
- **Минимум сессий:** 1 (нельзя удалить последнюю)
- **Авто-имя:** первые 30 символов первого user-сообщения + «...»
- **Ошибка загрузки:** сброс, автосоздание новой сессии

## Форматы данных

### Session
```json
{
  "meta": { "id": "session_<uuid>", "name": "...", "createdAt": 123, "lastActiveAt": 123, "messageCount": 0 },
  "messages": [{ "role": "user", "content": "..." }, ...]
}
```

## Тесты (session.test.ts, 11 тестов)

- Создаёт первую сессию при инициализации
- createSession() добавляет сессию; switchTo() меняет активную
- deleteSession() удаляет; нельзя удалить последнюю
- autoNameSession() — имя из первого сообщения, обрезает длинные
- getMessages() возвращает сообщения активной сессии
- Сообщения изолированы между сессиями; новая сессия — пустая история

## История изменений

| Версия | Дата | Изменения |
|--------|------|-----------|
| 0.7.0 | 2026-08-05 | crypto.randomUUID вместо Date.now |
| 0.1.0 | 2026-08-04 | Базовая реализация |
