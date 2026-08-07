#!/usr/bin/env node
/**
 * Исполняемый валидатор спецификаций SDD.
 * Проверяет структуру spec-файлов и соответствие src ↔ specs.
 * Запуск: node scripts/spec-validate.js
 */
const fs = require('fs');
const path = require('path');

const ROOT = path.dirname(__dirname);
const SPECS_DIR = path.join(ROOT, 'specs');
const SRC_DIR = path.join(ROOT, 'src');

const REQUIRED_SECTIONS = [
  '## Назначение', '## Интерфейс', '## Контракты',
  '## Связи', '## История изменений',
];

const META_SPECS = new Set(['ARCHITECTURE.md', 'TRACEABILITY.md', 'TEMPLATE.md']);

const SRC_EXEMPT = new Set([
  'index', 'types', 'extension', 'registerCommands',
  'base', 'diff', 'ContextBuilder', 'GhostTextManager', 'ChatPanel',
]);

const SRC_TO_SPEC = {
  'src/providers/manager.ts': 'ProviderManager.md',
  'src/providers/openai.ts': 'OpenAIProvider.md',
  'src/shared/logger.ts': 'Logger.md',
  'src/shared/streaming.ts': 'Streaming.md',
};

let errors = 0;

function err(msg) { console.log(`  ❌ ${msg}`); errors++; }
function ok(msg) { console.log(`  ✅ ${msg}`); }

// 1. Структура spec
console.log('\n=== 1. Структура spec-файлов ===');
for (const f of fs.readdirSync(SPECS_DIR).sort()) {
  if (!f.endsWith('.md')) continue;
  if (META_SPECS.has(f)) { ok(`${f}: мета-документ (пропуск)`); continue; }

  const content = fs.readFileSync(path.join(SPECS_DIR, f), 'utf8');
  const missing = REQUIRED_SECTIONS.filter(s => !content.includes(s));
  if (missing.length) err(`${f}: отсутствуют ${JSON.stringify(missing)}`);
  else ok(`${f}: все секции`);
}

// 2. Соответствие src → specs
console.log('\n=== 2. Соответствие src → specs ===');
function walk(dir) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) { walk(full); continue; }
    if (!entry.name.endsWith('.ts')) continue;
    const name = entry.name.replace('.ts', '');
    if (SRC_EXEMPT.has(name)) continue;

    const rel = path.relative(ROOT, full);
    const specName = SRC_TO_SPEC[rel] || `${name}.md`;
    if (fs.existsSync(path.join(SPECS_DIR, specName))) ok(`${rel} → ${specName}`);
    else err(`${rel}: нет ${specName}`);
  }
}
walk(SRC_DIR);

console.log(`\n=== Результат: ${errors} ошибок ===`);
process.exit(errors ? 1 : 0);
