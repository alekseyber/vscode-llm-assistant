#!/bin/bash
# SDD-гейт: изменённый src/**/Component.ts требует specs/Component.md, в котором ПОДНЯТА version.
#
# Единственный носитель правила. Два режима вызова:
#   bash scripts/sdd-check.sh --staged        # локально (pre-commit хук), смотрит индекс
#   bash scripts/sdd-check.sh --range A..B    # в CI, смотрит диапазон коммитов
#
# Почему оба режима в одном файле: раньше хук проверял только «спека изменена», а проверку
# «version поднят» содержал инлайн-скрипт в .github/workflows/sdd-check.yml. Из-за этого локально
# всё проходило, а CI краснел. Правило должно жить в одном месте.
#
# Установка хука (хуки в git не коммитятся):
#   cp scripts/sdd-check.sh .git/hooks/pre-commit && chmod +x .git/hooks/pre-commit

set -u

MODE="--staged"
RANGE=""
while [ $# -gt 0 ]; do
  case "$1" in
    --staged) MODE="--staged" ;;
    --range)  MODE="--range"; shift; RANGE="${1:-}" ;;
    *) echo "[SDD] неизвестный аргумент: $1"; exit 2 ;;
  esac
  shift
done

if [ "$MODE" = "--range" ]; then
  if [ -z "$RANGE" ] || [ "${RANGE#*..}" = "$RANGE" ]; then
    echo "[SDD] --range требует формат A..B"
    exit 2
  fi
  OLD_REF="${RANGE%%..*}"
  NEW_REF="${RANGE##*..}"
  CHANGED=$(git diff --name-only "$RANGE")
else
  OLD_REF="HEAD"
  NEW_REF=":"
  CHANGED=$(git diff --cached --name-only --diff-filter=ACM)
fi

CHANGED_TS=$(printf '%s\n' "$CHANGED" | grep -E '^src/.*\.ts$' || true)
CHANGED_SPECS=$(printf '%s\n' "$CHANGED" | grep -E '^specs/.*\.md$' || true)

if [ -z "$CHANGED_TS" ]; then
  echo "[SDD] изменённых .ts нет — проверка не требуется"
  exit 0
fi

echo "[SDD] изменённые .ts:"
printf '%s\n' "$CHANGED_TS" | sed 's/^/  /'

# Маппинг src-файла → имя спеки (единственный носитель; раньше дублировался в CI)
spec_for() {
  case "$1" in
    src/providers/manager.ts) echo "specs/ProviderManager.md" ;;
    src/providers/openai.ts)  echo "specs/OpenAIProvider.md" ;;
    src/providers/ollama.ts)  echo "specs/OllamaProvider.md" ;;
    src/shared/logger.ts)     echo "specs/Logger.md" ;;
    src/shared/streaming.ts)  echo "specs/Streaming.md" ;;
    src/shared/runSummary.ts) echo "specs/RunSummary.md" ;;
    src/shared/promptGuard.ts) echo "specs/PromptGuard.md" ;;
    src/shared/runStats.ts)   echo "specs/RunStats.md" ;;
    *)                        echo "specs/$(basename "$1" .ts).md" ;;
  esac
}

version_at() {
  # $1 — ревизия («:» = индекс), $2 — путь
  if [ "$1" = ":" ]; then
    git show ":$2" 2>/dev/null | grep -m1 '^version:' | sed 's/version:[[:space:]]*//' | tr -d '\r'
  else
    git show "$1:$2" 2>/dev/null | grep -m1 '^version:' | sed 's/version:[[:space:]]*//' | tr -d '\r'
  fi
}

VIOLATIONS=0
for ts_file in $CHANGED_TS; do
  component=$(basename "$ts_file" .ts)

  # Инфраструктура без собственной спеки (зеркало SRC_EXEMPT в spec-validate.js)
  case "$component" in
    index|types|extension|registerCommands|base|diff|ContextBuilder|GhostTextManager|ChatPanel|cleanLlmResponse)
      echo "  ⏭️  $ts_file — exempt (инфраструктура)"
      continue ;;
  esac

  spec_file=$(spec_for "$ts_file")

  if ! printf '%s\n' "$CHANGED_SPECS" | grep -qF "$spec_file"; then
    echo "  ❌ $ts_file → $spec_file не обновлена"
    VIOLATIONS=$((VIOLATIONS + 1))
    continue
  fi

  old_ver=$(version_at "$OLD_REF" "$spec_file")
  new_ver=$(version_at "$NEW_REF" "$spec_file")

  if [ -z "$new_ver" ]; then
    echo "  ❌ $spec_file: не удалось прочитать version"
    VIOLATIONS=$((VIOLATIONS + 1))
  elif [ -n "$old_ver" ] && [ "$old_ver" = "$new_ver" ]; then
    echo "  ❌ $spec_file: version не поднят ($new_ver) — нужен бамп и строка в «Истории изменений»"
    VIOLATIONS=$((VIOLATIONS + 1))
  else
    echo "  ✅ $ts_file → $spec_file (version ${old_ver:-—} → $new_ver)"
  fi
done

if [ "$VIOLATIONS" -gt 0 ]; then
  echo ""
  echo "[SDD] ❌ нарушений: $VIOLATIONS. Обнови specs/<Component>.md: version + строка в «Истории изменений»."
  exit 1
fi

echo "[SDD] ✅ все компоненты имеют обновлённую спеку с поднятой версией"
exit 0
