#!/usr/bin/env bash
# Ставит локальные git-хуки: pre-commit проверяет бамп спеки при правке src/.
set -euo pipefail
cd "$(dirname "$0")/.."

HOOK=".git/hooks/pre-commit"
cat > "$HOOK" <<'EOF'
#!/usr/bin/env bash
# 1) следы мутационного прогона в src/ (см. scripts/check-mutations-clean.js)
node scripts/check-mutations-clean.js || exit 1
# 2) «код + спека в одном коммите» (см. scripts/check-spec-bump.js)
exec node scripts/check-spec-bump.js
EOF
chmod +x "$HOOK"
echo "✅ установлен $HOOK"
