#!/bin/bash
# SDD pre-commit hook: проверяет что изменённые .ts файлы имеют обновлённый specs/<Component>.md
# Правило: src/**/ComponentName.ts → specs/ComponentName.md
# Установка: cp scripts/sdd-check.sh .git/hooks/pre-commit

set -e

CHANGED_TS=$(git diff --cached --name-only --diff-filter=ACM | grep '^src/.*\.ts$' || true)
CHANGED_SPECS=$(git diff --cached --name-only --diff-filter=ACM | grep '^specs/.*\.md$' || true)

if [ -z "$CHANGED_TS" ]; then
  exit 0
fi

echo "[SDD] Проверка консистентности spec ↔ код..."
echo "[SDD] Изменённые .ts:"
echo "$CHANGED_TS" | sed 's/^/  /'

VIOLATIONS=0

# Маппинг src-файла → имя спеки (не совпадает с basename). Держать в синхроне с
# .github/workflows/sdd-check.yml и scripts/spec-validate.js SRC_TO_SPEC.
spec_for() {
  case "$1" in
    src/providers/manager.ts) echo "specs/ProviderManager.md" ;;
    src/providers/openai.ts)  echo "specs/OpenAIProvider.md" ;;
    src/providers/ollama.ts)  echo "specs/OllamaProvider.md" ;;
    src/shared/logger.ts)     echo "specs/Logger.md" ;;
    src/shared/streaming.ts)  echo "specs/Streaming.md" ;;
    *)                        echo "specs/$(basename "$1" .ts).md" ;;
  esac
}

for ts_file in $CHANGED_TS; do
  # Извлекаем имя компонента: src/modes/apply/AgentWorker.ts → AgentWorker
  component=$(basename "$ts_file" .ts)

  # Пропускаем index, types, extension, registerCommands
  case "$component" in
    index|types|extension|registerCommands|base|diff|ContextBuilder|GhostTextManager|ChatPanel)
      continue ;;
  esac

  spec_file=$(spec_for "$ts_file")

  if ! echo "$CHANGED_SPECS" | grep -qF "$spec_file"; then
    echo "  ❌ $ts_file → $spec_file НЕ обновлён"
    VIOLATIONS=$((VIOLATIONS + 1))
  else
    echo "  ✅ $ts_file → $spec_file обновлён"
  fi
done

if [ $VIOLATIONS -gt 0 ]; then
  echo ""
  echo "❌ SDD VIOLATION: $VIOLATIONS компонентов без обновлённого spec."
  echo "   Обнови соответствующий specs/<Component>.md."
  echo "   Для bypass: git commit --no-verify"
  exit 1
fi

echo "[SDD] ✅ Все компоненты имеют обновлённый spec."
exit 0
