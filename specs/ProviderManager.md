---
component: ProviderManager
version: 0.8.0
status: stable
since: 0.1.0
---

## Назначение

Управление LLM-провайдерами: чтение конфигурации из VS Code settings, создание OpenAI-совместимых провайдеров, доступ по имени.

## Интерфейс

### `new ProviderManager()`

При создании вызывает `refresh()` — читает `llmAssistant.providers` из settings.json.

### `providerManager.getProvider(name) → LLMProvider | undefined`

### `providerManager.getDefault() → LLMProvider | undefined`

Использует `llmAssistant.defaultProvider`, fallback на `'openai'`.

### `providerManager.getAllProviders() → Map<string, LLMProvider>`

### `providerManager.refresh()`

Перечитывает конфиг, очищает старых провайдеров, создаёт новых.

### `providerManager.pricingMap → PricingMap`

Карта цен моделей (из конфига + fallback-таблица).

## Конфигурация (settings.json)

```json
{
  "llmAssistant.providers": {
    "deepseek": {
      "baseUrl": "https://api.deepseek.com/v1",
      "apiKey": "sk-...",
      "models": [
        "deepseek-chat",
        { "name": "deepseek-v4-pro", "pricing": { "input": 0.435, "output": 0.87 } }
      ]
    }
  }
}
```

### Формат models

| Формат | Пример | Цена |
|--------|--------|------|
| Строка | `"deepseek-chat"` | Из fallback-таблицы |
| Объект с pricing | `{ "name": "...", "pricing": { "input": 0.14, "output": 0.28 } }` | Из конфига |
| Объект без pricing | `{ "name": "..." }` | Из fallback-таблицы |

### Подстановка переменных

`${VAR}` в `apiKey` и `baseUrl` заменяются на `process.env[VAR]`.

## Контракты

| Ситуация | Поведение |
|----------|-----------|
| Провайдер не найден | `getProvider()` → `undefined` |
| `defaultProvider` не задан | `getDefault()` → `'openai'` |
| `models` отсутствует | `[]` |
| `apiKey` содержит `${VAR}` | Подстановка из `process.env` |
| Переменная не найдена | Остаётся `${VAR}` как есть |

## Связи

- **Использует:** `OpenAIProvider`, `types.ModelEntry`, `types.calculateCost`
- **Используется:** `ChatViewProvider`, `registerCommands.startApplyMode`

## AC

| ID | Критерий | Статус |
|----|----------|--------|
| AC-9.4 | refresh() читает конфиг и создаёт провайдеров | ✅ |
|  — | getProvider() возвращает undefined для неизвестного | ✅ |
|  — | getDefault() возвращает провайдера по умолчанию | ✅ |
|  — | pricingMap строится из ModelEntry[] + fallback | ✅ |
|  — | extractModelNames() извлекает имена из ModelEntry[] | ✅ |
|  — | calculateCost() использует pricingMap > fallback > default | ✅ |

## Детали реализации

- **Конфиг:** `llmAssistant.providers` (Record<string, {baseUrl, apiKey, models}>)
- **Variables:** `${VAR}` → `process.env[VAR]` в baseUrl и apiKey
- **Pricing:** `buildPricingMap(ModelEntry[])` → приоритет: конфиг > FALLBACK > DEFAULT
- **extractModelNames:** `ModelEntry[]` → `string[]` для OpenAIProvider
- **defaultProvider:** `llmAssistant.defaultProvider` или `'openai'`


## Тесты (providers.test.ts, 11 тестов)

- AC-9.4: refresh() читает конфиг и создаёт провайдеров
- getProvider() возвращает undefined для неизвестного
- getDefault() возвращает провайдера по умолчанию; 'openai' если не задан
- getAllProviders() возвращает всех; refresh() очищает старых
- Пустая конфигурация: getDefault() → undefined
- ${VAR} подстановка: из process.env; оставляет если переменная не найдена
- Провайдер имеет список моделей из конфигурации

## История изменений

| Версия | Дата | Изменения |
|--------|------|-----------|
| 0.8.0 | 2026-08-06 | ModelEntry, pricingMap, calculateCost |
| 0.1.0 | 2026-08-04 | Базовая реализация |
