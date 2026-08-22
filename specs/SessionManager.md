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

### `addMessageTo(sessionId, message)` — запись в конкретную сессию (не обязательно активную)

### `switchTo(id)` / `createSession(name?) → id` / `deleteSession(id) → boolean`

### `renameSession(id, name)` / `autoNameSession(id)` / `clearActive()`

### `duplicateSession(sourceId, messageCount?) → newId | undefined` — копия сессии (fork/resume), переключает активную

### `touchSession(sessionId, messageCount)` — обновить meta (lastActiveAt + messageCount) без хранения messages (F1 5d)

### `clearAll()` — удалить все сессии, создать одну свежую

### `autoNameSession(id, firstUserContent?)` — авто-имя из первого user-сообщения (контент извне — F1 5d)

> `addMessage` / `addMessageTo` / `getMessages` — **@deprecated** (F1 5d): сообщения живут в session-log, SessionManager остаётся реестром meta.

## Контракты

| Ситуация | Поведение |
|----------|-----------|
| Нет сессий при старте | Автосоздание «Сессия 1» |
| Удаление последней сессии | Автосоздание новой пустой сессии |
| Удаление активной сессии | Переключение на последнюю оставшуюся |
| ID коллизия | `crypto.randomUUID()` — гарантирует уникальность |
| >100 сообщений | slice(-100) — старые вытесняются |
| Ошибка загрузки из storage | Сброс, создание новой сессии |
| Первое сообщение → авто-имя | Первые 30 символов + «...» |
| `addMessageTo(неактивная сессия)` | Пишет в указанную сессию, активная не меняется |

## Связи

- **Использует:** `vscode.Memento`
- **Используется:** `ConversationManager`

## Детали реализации

- **ID:** `session_${crypto.randomUUID()}` — гарантирует уникальность
- **FIFO:** максимум 100 сообщений, старые вытесняются `slice(-100)`
- **Хранение:** два ключа в workspaceState — `llmAssistant.chat.sessions` ({id: Session}) и `llmAssistant.chat.activeSession` (id)
- **Сортировка:** `listSessions()` — по lastActiveAt (новые сверху)
- **Минимум сессий:** при удалении последней — автосоздаётся новая
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

## Тесты (session.test.ts, 12 тестов)

- Создаёт первую сессию при инициализации
- createSession() добавляет сессию; switchTo() меняет активную
- deleteSession() удаляет; нельзя удалить последнюю
- autoNameSession() — имя из первого сообщения, обрезает длинные
- getMessages() возвращает сообщения активной сессии
- Сообщения изолированы между сессиями; новая сессия — пустая история
- addMessageTo() пишет в конкретную сессию, а не в активную

## История изменений

| Версия | Дата | Изменения |
|--------|------|-----------|
| 0.7.0 | 2026-08-05 | crypto.randomUUID вместо Date.now |
| 0.1.0 | 2026-08-04 | Базовая реализация |
| 0.10.0 | 2026-08-20 | `addMessageTo(sessionId)` — сессионная маршрутизация сообщений |
| 0.11.3 | 2026-08-22 | `duplicateSession(sourceId)` — копия сессии для fork/resume |
| 0.11.3 | 2026-08-22 | F1 5d: `touchSession` + `autoNameSession(content)`; messages-методы @deprecated (реестр = meta) |
