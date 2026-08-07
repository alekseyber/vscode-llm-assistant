---
component: AgentSharedContext
version: 0.8.0
status: stable
since: 0.7.0
---

## Назначение

Общий контекст для коммуникации между воркерами в multi-agent оркестрации. In-memory хранилище артефактов (файлов, результатов).

## Интерфейс

### `put(key, content, createdBy)` — сохранить артефакт

### `get(key) → SharedArtifact | undefined`

### `list() → SharedArtifact[]` — все артефакты в хронологическом порядке

### `listByRole(roleName) → SharedArtifact[]`

### `summary() → string` — сводка для передачи воркеру

## SharedArtifact

| Поле | Тип |
|------|-----|
| key | string |
| content | string |
| createdBy | string (имя роли) |
| timestamp | number |

## Контракты

| Ситуация | Поведение |
|----------|-----------|
| Несуществующий ключ | `get()` → undefined |
| Пустой контекст | `list()` → [], `summary()` → «(нет артефактов)» |
| Артефакты > 500 символов | Обрезаются в `summary()` |

## Связи

- **Используется:** AgentOrchestrator (sharedContext)
- **Сценарий:** parallel/sequential/pipeline — сохранение результатов

## Детали реализации

- **Хранение:** `Map<string, SharedArtifact>` в памяти
- **Artifact:** `{key, content, createdBy, timestamp: Date.now()}`
- **Сортировка:** `list()` — по timestamp (хронологическая)
- **Summary:** каждый артефакт с заголовком `### {key} (от {createdBy})
\`\`\`
{content.slice(0,500)}
\`\`\``


## Тесты (agentCommunication.test.ts + agentOrchestrator.test.ts)

- MA-3.1: parallel — результаты всех воркеров сохраняются в SharedContext; sequential — следующий воркер видит контекст
- MA-3.3: pipeline — артефакты сохраняются в SharedContext
- put/get: артефакт сохраняется и читается
- list: хронологический порядок; listByRole: фильтрация
- summary: форматирование всех артефактов
- Пустой SharedContext: пустой список, get → undefined

## История изменений

| Версия | Дата | Изменения |
|--------|------|-----------|
| 0.7.0 | 2026-08-05 | Базовая реализация |
