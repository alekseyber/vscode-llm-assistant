#!/bin/bash
# SDD pre-commit hook: проверяет что изменённые .ts файлы имеют обновлённый specs/*.md
# Устанавливается: cp scripts/sdd-check.sh .git/hooks/pre-commit

set -e

CHANGED_TS=$(git diff --cached --name-only --diff-filter=ACM | grep '^src/.*\.ts$' || true)
CHANGED_SPECS=$(git diff --cached --name-only --diff-filter=ACM | grep '^specs/.*\.md$' || true)

if [ -z "$CHANGED_TS" ]; then
  exit 0  # Нет изменений в .ts — ок
fi

echo "[SDD] Проверка консистентности spec ↔ код..."
echo "[SDD] Изменённые .ts:"
echo "$CHANGED_TS" | sed 's/^/  /'

if [ -z "$CHANGED_SPECS" ]; then
  echo ""
  echo "❌ SDD VIOLATION: изменены исходники, но specs/ не обновлены."
  echo "   Обнови specs/<Component>.md или specs/ARCHITECTURE.md."
  echo "   Для bypass: git commit --no-verify"
  exit 1
fi

echo "[SDD] Изменённые specs:"
echo "$CHANGED_SPECS" | sed 's/^/  /'
echo "[SDD] ✅ Консистентность соблюдена."
exit 0
