---
component: ProviderManager
version: 0.14.2
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

Использует `llmAssistant.defaultProvider`, fallback на первый настроенный провайдер.

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
    },
    "local": {
      "type": "ollama",
      "baseUrl": "http://127.0.0.1:11434",
      "models": []
    }
  }
}
```

### Поле type

| Значение | Что создаётся | apiKey | Цена модели |
|----------|---------------|--------|-------------|
| отсутствует или `"openai"` | `OpenAIProvider` | обязателен по смыслу (пустая строка допустима) | из конфига / fallback |
| `"ollama"` | `OllamaProvider` (нативный `/api/chat`) | не требуется | 0 (`{input:0, output:0}` в `pricingMap`) |

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
| `defaultProvider` не задан | `getDefault()` → первый настроенный провайдер |
| `models` отсутствует | `[]` |
| `apiKey` содержит `${VAR}` | Подстановка из `process.env` |
| Переменная не найдена | Остаётся `${VAR}` как есть |
| `type: "ollama"` | Создаётся `OllamaProvider`, `isLocal = true` |
| `type: "ollama"` без `baseUrl` | `http://127.0.0.1:11434` |
| `type: "ollama"`, `models: []` | Список моделей берётся из `OllamaProvider.models()` (discovery), конфиг — fallback |
| Локальный провайдер | Все его модели (из конфига **и** из discovery) попадают в `_pricingMap` с `{input:0, output:0}` — `calculateCost()` возвращает 0, а не `DEFAULT_PRICING` |
| Discovery вернул модели после `refresh()` | `_pricingMap` дополняется нулевыми ценами в момент заполнения кэша discovery, не в конструкторе |
| Неизвестный `type` | Провайдер не создаётся, в debug-лог пишется ошибка конфигурации |

## Связи

- **Использует:** `OpenAIProvider`, `OllamaProvider`, `types.ModelEntry`, `types.calculateCost`
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
| PRM-1.1 | `type: "ollama"` → `OllamaProvider`, `isLocal = true` | ✅ |
| PRM-1.2 | `type` отсутствует → `OpenAIProvider` (обратная совместимость) | ✅ |
| PRM-1.3 | `Type` описан в `ProviderConfig` как `type?: 'openai' \| 'ollama'` | ✅ |
| PRM-1.4 | Локальные модели получают цену 0 — из конфига и из discovery | ✅ |
| PRM-1.5 | Неизвестный `type` → провайдер не создан, ошибка в лог, остальные провайдеры работают | ✅ |
| PRM-1.6 | Нулевые цены локальных моделей переживают `refresh()` (правка settings.json) — дефект «768+40 = 0.0004» из ручного прогона | ✅ |

## Детали реализации

- **Конфиг:** `llmAssistant.providers` (Record<string, {baseUrl, apiKey, models}>)
- **Variables:** `${VAR}` → `process.env[VAR]` в baseUrl и apiKey
- **Pricing:** `buildPricingMap(ModelEntry[])` → приоритет: конфиг > FALLBACK > DEFAULT
- **extractModelNames:** `ModelEntry[]` → `string[]` для OpenAIProvider
- **defaultProvider:** `llmAssistant.defaultProvider` или `'openai'`
- **Ветка `type`:** `providerCfg.type === 'ollama'` → `new OllamaProvider({name, baseUrl, models, supportsVision})`, иначе `new OpenAIProvider(...)`; `apiKey` для локального не подставляется из env (не нужен)
- **Обнуление цен:** `localModels` (Set) хранит имена бесплатных моделей **отдельно** от `_pricingMap`, потому что `refresh()` её очищает при любом изменении настроек. Геттер `pricingMap` накладывает нули поверх карты, поэтому цена остаётся нулевой и после правки `settings.json`. `calculateCost()` не меняется
- **Discovery-кэш:** `ProviderManager` не вызывает `models()` синхронно в `refresh()` (метод синхронный); список обновляется после заполнения кэша `OllamaProvider` и рассылается в WebView


## Тесты (providers.test.ts, 11 тестов)

- AC-9.4: refresh() читает конфиг и создаёт провайдеров
- getProvider() возвращает undefined для неизвестного
- getDefault() возвращает провайдера по умолчанию; 'openai' если не задан
- getAllProviders() возвращает всех; refresh() очищает старых
- Пустая конфигурация: getDefault() → undefined
- ${VAR} подстановка: из process.env; оставляет если переменная не найдена
- Провайдер имеет список моделей из конфигурации
- PRM-1.1/1.3: `type: "ollama"` создаёт `OllamaProvider` с `isLocal`, без `baseUrl` подставляется `http://127.0.0.1:11434` (`providerManagerLocal.test.ts`)
- PRM-1.2: конфиг без `type` даёт `OpenAIProvider` (обратная совместимость)
- PRM-1.4: цена локальной модели 0 (`calculateCost` → 0), облачная цена не затёрта; `setZeroPricing()` обнуляет модели из discovery
- PRM-1.5: неизвестный `type` пропускается, остальные провайдеры создаются, локальный не требует `apiKey`
- PRM-1.6: `setZeroPricing` + `refresh()` → цена локальной модели остаётся 0 (`providerManagerLocal.test.ts`, «нули переживают refresh()»)

## История изменений

| Версия | Дата | Изменения |
|--------|------|-----------|
| 0.14.2 | 2026-11-07 | Фикс по ручному прогону: `localModels` живёт вне `_pricingMap`, нули переживают `refresh()` (было «768+40 токенов = 0.0004» у локальной модели) |
| 0.14.1 | 2026-11-07 | Stage 2: ветка `type` реализована, `DEFAULT_OLLAMA_BASE_URL`, `setZeroPricing()`, неизвестный `type` пропускается; 7 тестов `providerManagerLocal.test.ts` |
| 0.14.0 | 2026-11-07 | `type` в конфиге (openai/ollama), ветка `OllamaProvider`, нулевые цены для локальных моделей (конфиг + discovery), `isLocal` |
| 0.13.0 | 2026-08-23 | getDefault() fallback на первый настроенный провайдер |
| 0.8.0 | 2026-08-06 | ModelEntry, pricingMap, calculateCost |
| 0.1.0 | 2026-08-04 | Базовая реализация |
