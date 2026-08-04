# Процесс деплоя и публикации VS Code LLM Assistant

**Документ:** описание фактического процесса публикации v0.1.0 (2026-08-04)
**Цель:** детальное понимание каждого шага, чтобы воспроизводить и управлять релизами

---

## Общая схема

```
Локальный код (Docker) ──git push──> GitHub ──tag v*──> GitHub Actions ──Entra ID OIDC──> Azure Managed Identity ──> vsce publish ──> Marketplace
```

Три ключевых компонента:
1. **GitHub** — репозиторий, тэги, workflow, secrets, environment
2. **Azure** — Managed Identity + Federated Credential (аутентификация без токенов)
3. **VS Code Marketplace** — издатель alekseyber, само расширение

---

## Часть 1. Одноразовая настройка инфраструктуры

> Выполняется ОДИН раз. После этого релизы — просто `git tag` + push.

### Шаг 1.1. Создание издателя в Marketplace

```
1. https://marketplace.visualstudio.com/manage/publishers
2. Вход через GitHub (аккаунт alekseyber)
3. Create Publisher:
   - Name: Aleksey Berestov
   - ID: alekseyber  ← ДОЛЖЕН совпадать с "publisher" в package.json
4. Создано
```

**Замечание:** меню «Security → New PAT» в 2026 уже нет — Microsoft отменяет PAT
(глобальные PAT выключаются с 01.12.2026). Используем Entra ID вместо них.

### Шаг 1.2. Регистрация Azure-аккаунта

```
1. https://portal.azure.com → зарегистрироваться
2. Форма: страна, адрес, телефон (для free-тарифа)
3. Подтверждение картой (бесплатный тариф, холд ~$1)
```

**Замечание:** для Managed Identity Azure-подписка НЕ обязательна в теории,
но проще иметь её. Регион West Europe может не принимать новых клиентов —
выбрали North Europe.

### Шаг 1.3. Создание Managed Identity

```
portal.azure.com → поиск "Managed Identities" → Services → Managed Identities
→ + Create (прямая ссылка: portal.azure.com/#create/Microsoft.ManagedIdentity)
→ Заполнить:
   - Resource group:  rg-vscode (создать новую)
   - Region:          North Europe (West Europe был недоступен)
   - Name:            vscode-publisher
→ Review + create → Create
```

**Что это:** Managed Identity = учётная запись Azure без пароля. Она получает
временные токены через OIDC (федеративные credentials) — именно этим
аутентифицируется GitHub Actions.

### Шаг 1.4. Federated Credential (связка GitHub ↔ Azure)

```
1. На ресурсе vscode-publisher → Settings → Federated credentials
2. + Add credential
3. Сценарий: "GitHub Actions deploying Azure resources"
4. Заполнить:
   - Organization: 53495956          ← GitHub User ID (НЕ имя!)
   - Repository:   1322211000        ← GitHub Repo ID (НЕ имя!)
   - Entity type:  Environment       ← ВАЖНО: не Branch, не Tag
   - Environment name: marketplace-publish
   - Name: github-actions
5. Add
```

**Как получить числовые ID:**
```bash
curl https://api.github.com/users/alekseyber     # → "id": 53495956
curl https://api.github.com/repos/alekseyber/vscode-llm-assistant  # → "id": 1322211000
```

**Почему Entity type = Environment:** Branch/Tag ломаются на втором релизе
(тэг пересоздаётся → subject claim не совпадает). Environment стабилен.

### Шаг 1.5. GitHub Secrets

```
GitHub → Settings → Secrets and variables → Actions → New repository secret:
- AZURE_CLIENT_ID = <YOUR_AZURE_CLIENT_ID>
- AZURE_TENANT_ID = <YOUR_AZURE_TENANT_ID>
```

**Как определить, что есть что** (важно! на странице Properties два GUID):
```bash
# OIDC endpoint отвечает 200 → это Tenant ID
curl -s -o /dev/null -w "%{http_code}" \
  https://login.microsoftonline.com/<GUID>/v2.0/.well-known/openid-configuration
# 200 = Tenant ID, 400 = это Client ID (или Object ID)
```

### Шаг 1.6. GitHub Environment

```
GitHub → Settings → Environments → New environment → marketplace-publish
```

Создан через API (PUT environments/marketplace-publish). Нужен, потому что
Federated Credential указывает на environment.

### Шаг 1.7. Добавление identity в издателя (самый неочевидный шаг)

Marketplace принимает НЕ Client ID и НЕ Tenant ID, а свой внутренний Azure
DevOps-профиль identity. Его можно получить ТОЛЬКО выполнив код от имени
identity:

**Временный workflow `debug-identity.yml`:**
```yaml
name: Debug Identity
on: workflow_dispatch
permissions:
  id-token: write
  contents: read
jobs:
  debug:
    runs-on: ubuntu-latest
    environment: marketplace-publish
    steps:
      - uses: azure/login@v2
        with:
          client-id: ${{ secrets.AZURE_CLIENT_ID }}
          tenant-id: ${{ secrets.AZURE_TENANT_ID }}
          allow-no-subscriptions: true
      - run: az rest -u https://app.vssps.visualstudio.com/_apis/profile/profiles/me --resource 499b84ac-1321-427f-aa17-267ca6975798
```

**Результат в логах:**
```json
{ "id": "d6ea71ce-11f5-69d3-a16a-d63feb8807f1", ... }
```

**Добавление:**
```
https://marketplace.visualstudio.com/manage/publishers/alekseyber
→ Members → Add → вставить d6ea71ce-11f5-69d3-a16a-d63feb8807f1
→ Роль: Contributor → Save
```

**После получения ID** временный workflow удаляется.

---

## Часть 2. Процесс публикации (каждый релиз)

### Шаг 2.1. Локальная сборка и проверка

```bash
cd ~/projects/vscode-llm-assistant
npm ci              # чистая установка зависимостей
npm run compile     # webpack сборка → dist/extension.js
npm test            # unit-тесты (65 passing)
npx @vscode/vsce package   # собрать .vsix локально (проверка)
```

### Шаг 2.2. Создание релизного тэга

```bash
git tag v0.1.0
git push origin v0.1.0
```

Push тэга запускает workflow `Publish` (триггер `on: push: tags: ['v*']`).

### Шаг 2.3. Workflow Publish (.github/workflows/publish.yml)

```yaml
name: Publish
on:
  push:
    tags: ['v*']
  workflow_dispatch:
permissions:
  id-token: write     # ← ключевое: разрешение на OIDC-токен
  contents: read
jobs:
  publish:
    runs-on: ubuntu-latest
    environment: marketplace-publish   # ← привязка к environment (для OIDC)
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with: { node-version: 20.x }
      - run: npm ci
      - run: npm run compile
      - uses: azure/login@v2             # ← вход в Azure через OIDC
        with:
          client-id: ${{ secrets.AZURE_CLIENT_ID }}
          tenant-id: ${{ secrets.AZURE_TENANT_ID }}
          allow-no-subscriptions: true
      - run: npx @vscode/vsce publish --azure-credential   # ← публикация
```

**Что происходит внутри azure/login@v2:**
1. GitHub выпускает OIDC-токен (id-token: write)
2. Токен содержит subject claim: `repo:alekseyber@53495956/vscode-llm-assistant@1322211000:environment:marketplace-publish`
3. Azure сверяет claim с Federated Credential (Шаг 1.4)
4. Если совпало — Azure выдаёт временный access token для Managed Identity
5. `az` CLI авторизован от имени identity
6. `vsce publish --azure-credential` использует этот токен для публикации

### Шаг 2.4. Что делает vsce publish

1. Собирает VSIX (пакует dist/, media/, README, LICENSE и т.д.)
2. Проверяет манифест:
   - publisher: alekseyber
   - displayName: VS Code LLM Assistant
   - version: 0.1.0
   - engines.vscode: ^1.131.0
3. Загружает в Marketplace
4. Marketplace валидирует и публикует

### Шаг 2.5. Проверка публикации

```bash
# 1. Расширение есть в галерее:
curl -s -X POST "https://marketplace.visualstudio.com/_apis/public/gallery/extensionquery?api-version=3.0-preview.1" \
  -H "Content-Type: application/json" \
  -d '{"filters":[{"criteria":[{"filterType":7,"value":"alekseyber.vscode-llm-assistant"}]}],"flags":255}'
# → flags: validated, public

# 2. Поиск (индексация может занять часы):
# фильтр по имени "VS Code LLM Assistant"

# 3. Установка:
code --install-extension alekseyber.vscode-llm-assistant
```

---

## Часть 3. Автоматизированный этап «Релиз»

**Cronjob:** `baafba05ca78` (durable, запуск по команде)
**Скрипт:** `/opt/data/scripts/release.py` (в контейнере Hermes)

### Что делает release.py:

```
1. Читает версию из package.json
2. git tag -f v{version} && git push origin v{version}
3. Ждёт workflow Publish (опрос GitHub API каждые 15с, макс 10 мин)
4. Собирает статусы шагов (npm ci, compile, azure/login, publish)
5. Проверяет расширение в Marketplace (Gallery API)
6. Пишет отчёт reports/release-{version}-{дата}.md
7. Возвращает 0/1 → результат в чат
```

### Запуск релиза одной командой:

```bash
# Через cronjob API (агент):
cronjob run baafba05ca78

# Или вручную:
cd /opt/data && python3 scripts/release.py
```

---

## Часть 4. Проблемы, найденные при первом релизе

| # | Проблема | Симптом | Решение |
|---|----------|---------|---------|
| 1 | `@types/vscode@^1.131.0` не существует на npm | `npm ci` → ETARGET | Поставить `^1.125.0` (максимальная доступная) |
| 2 | displayName «LLM Assistant» занят | `vsce publish` → "This extension display name is taken" | Переименовать в «VS Code LLM Assistant» |
| 3 | Нет поля repository в package.json | Warning при публикации | Добавить `repository` в манифест |
| 4 | Расширение не находится через `code --install-extension` сразу | "Расширение не найдено" | Индексация Marketplace занимает время (часы) |
| 5 | OIDC endpoint путаница Client/Tenant ID | Некорректные secrets | Проверка через login.microsoftonline.com (200=tenant) |
| 6 | West Europe не принимает новых клиентов | RequestDisallowedByAzure | Выбрать North Europe |

---

## Полезные ссылки

| Что | Где |
|-----|-----|
| Расширение в Marketplace | https://marketplace.visualstudio.com/items?itemName=alekseyber.vscode-llm-assistant |
| Workflow Publish | `.github/workflows/publish.yml` |
| Скрипт релиза | `/opt/data/scripts/release.py` |
| Инструкция пользователя | `docs/USER-GUIDE.md` |
| Сводный отчёт | `reports/SUMMARY.md` |
| Отчёт релиза | `reports/release-0.1.0-2026-08-04_15-12.md` |
| Управление издателем | https://marketplace.visualstudio.com/manage/publishers/alekseyber |
| Managed Identity | portal.azure.com → rg-vscode → vscode-publisher |
| GitHub Actions | https://github.com/alekseyber/vscode-llm-assistant/actions |

---

## Чек-лист следующего релиза (v0.2.0)

```bash
# 1. Поднять версию
sed -i 's/"version": "0.1.0"/"version": "0.2.0"/' package.json
npm install && git add package.json package-lock.json
git commit -m "chore: версия 0.2.0" && git push origin main

# 2. Запустить релиз (автоматически)
# → агент: cronjob run baafba05ca78
# Или вручную:
git tag v0.2.0 && git push origin v0.2.0

# 3. Дождаться workflow (2-3 мин) и проверить Marketplace
```