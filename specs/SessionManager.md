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

## История изменений

| Версия | Дата | Изменения |
|--------|------|-----------|
| 0.7.0 | 2026-08-05 | crypto.randomUUID вместо Date.now |
| 0.1.0 | 2026-08-04 | Базовая реализация |
