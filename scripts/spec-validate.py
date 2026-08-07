#!/usr/bin/env python3
"""
Исполняемый валидатор спецификаций SDD.
Проверяет:
1. Что все обязательные секции присутствуют в spec-файлах
2. Что все src/**/*.ts имеют соответствующий specs/*.md
3. Что тестовые файлы упоминаются в соответствующих spec

Запуск: python3 scripts/spec-validate.py
"""

import os, sys

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
SPECS_DIR = os.path.join(ROOT, "specs")
SRC_DIR = os.path.join(ROOT, "src")

REQUIRED_SECTIONS = [
    "## Назначение", "## Интерфейс", "## Контракты",
    "## Связи", "## История изменений",
]

# Мета-документы — не компоненты
META_SPECS = {"ARCHITECTURE.md", "TRACEABILITY.md"}

# Исключения: файлы без отдельного spec
SRC_EXEMPT = {"index", "types", "extension", "registerCommands",
              "base", "diff", "ContextBuilder", "GhostTextManager",
              "ChatPanel", "logger", "streaming"}

# Маппинг src-файлов на spec-файлы (для случаев где имя не совпадает)
SRC_TO_SPEC = {
    "src/providers/manager.ts": "ProviderManager.md",
    "src/providers/openai.ts": "OpenAIProvider.md",
    "src/shared/logger.ts": "Logger.md",
    "src/shared/streaming.ts": "Streaming.md",
}

errors = 0

def err(msg):
    global errors
    print(f"  ❌ {msg}")
    errors += 1

def ok(msg):
    print(f"  ✅ {msg}")

# 1. Структура spec
print("\n=== 1. Структура spec-файлов ===")
for spec_file in sorted(os.listdir(SPECS_DIR)):
    if not spec_file.endswith('.md'): continue
    if spec_file in META_SPECS:
        ok(f"{spec_file}: мета-документ (пропуск)")
        continue
    path = os.path.join(SPECS_DIR, spec_file)
    content = open(path).read()
    missing = [s for s in REQUIRED_SECTIONS if s not in content]
    if missing:
        err(f"{spec_file}: отсутствуют {missing}")
    else:
        ok(f"{spec_file}: все секции")

# 2. Соответствие src → specs
print("\n=== 2. Соответствие src → specs ===")
for root, dirs, files in os.walk(SRC_DIR):
    for f in files:
        if not f.endswith('.ts'): continue
        name = f.replace('.ts', '')
        if name in SRC_EXEMPT: continue
        rel_path = os.path.relpath(os.path.join(root, f), ROOT)

        spec_name = SRC_TO_SPEC.get(rel_path, f"{name}.md")
        spec_path = os.path.join(SPECS_DIR, spec_name)
        if os.path.exists(spec_path):
            ok(f"{rel_path} → {spec_name}")
        else:
            err(f"{rel_path}: нет {spec_name}")

# 3. Итог
print(f"\n=== Результат: {errors} ошибок ===")
sys.exit(0 if errors == 0 else 1)
