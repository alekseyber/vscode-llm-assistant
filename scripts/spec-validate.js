#!/usr/bin/env node
/**
 * Исполняемый валидатор спецификаций SDD.
 * Проверки:
 *   1. Структура spec-файлов (обязательные секции).
 *   2. Соответствие src → specs (прямое покрытие кода).
 *   3. version ↔ «История изменений» (version не отстаёт и не опережает).
 *   4. Обратное покрытие (у каждой спеки есть код, кроме planned/deprecated).
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
  'cleanLlmResponse',
]);

const SRC_TO_SPEC = {
  'src/providers/manager.ts': 'ProviderManager.md',
  'src/providers/openai.ts': 'OpenAIProvider.md',
  'src/shared/logger.ts': 'Logger.md',
  'src/shared/streaming.ts': 'Streaming.md',
};

// Статусы, освобождающие спеку от требования «есть код» (обратное покрытие).
const REVERSE_EXEMPT_STATUS = new Set(['planned', 'deprecated']);

// Спеки, документирующие НЕ-.ts-компоненты (WebView — фронтенд JS/HTML/CSS).
const REVERSE_EXEMPT_SPECS = new Set(['WebView.md']);

let errors = 0;

function err(msg) { console.log(`  ❌ ${msg}`); errors++; }
function ok(msg) { console.log(`  ✅ ${msg}`); }

// Сравнение semver X.Y.Z численно (0.10.0 > 0.9.0).
function cmpVer(a, b) {
  const pa = a.split('.').map(Number);
  const pb = b.split('.').map(Number);
  for (let i = 0; i < 3; i++) {
    const x = pa[i] || 0, y = pb[i] || 0;
    if (x !== y) return x - y;
  }
  return 0;
}

function readSpec(name) {
  return fs.readFileSync(path.join(SPECS_DIR, name), 'utf8');
}

// Читает поле из YAML-frontmatter спеки.
function frontmatter(content, key) {
  const m = content.match(new RegExp(`^${key}:\\s*(.+)$`, 'm'));
  return m ? m[1].trim() : null;
}

// Последняя (максимальная) версия из таблицы «История изменений».
function latestHistoryVersion(content) {
  const versions = [];
  const re = /^\|\s*(\d+\.\d+\.\d+)\s*\|/gm;
  let m;
  while ((m = re.exec(content)) !== null) versions.push(m[1]);
  if (versions.length === 0) return null;
  versions.sort(cmpVer);
  return versions[versions.length - 1];
}

// 1. Структура spec
console.log('\n=== 1. Структура spec-файлов ===');
for (const f of fs.readdirSync(SPECS_DIR).sort()) {
  if (!f.endsWith('.md')) continue;
  if (META_SPECS.has(f)) { ok(`${f}: мета-документ (пропуск)`); continue; }

  const content = readSpec(f);
  const missing = REQUIRED_SECTIONS.filter(s => !content.includes(s));
  if (missing.length) err(`${f}: отсутствуют ${JSON.stringify(missing)}`);
  else ok(`${f}: все секции`);
}

// 2. Соответствие src → specs + сбор множества покрытых спек (для проверки 4)
console.log('\n=== 2. Соответствие src → specs ===');
const specHasSrc = new Set();
function walk(dir) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) { walk(full); continue; }
    if (!entry.name.endsWith('.ts')) continue;
    const name = entry.name.replace('.ts', '');
    if (SRC_EXEMPT.has(name)) continue;

    const rel = path.relative(ROOT, full);
    const specName = SRC_TO_SPEC[rel] || `${name}.md`;
    specHasSrc.add(specName);
    if (fs.existsSync(path.join(SPECS_DIR, specName))) ok(`${rel} → ${specName}`);
    else err(`${rel}: нет ${specName}`);
  }
}
walk(SRC_DIR);

// 3. version ↔ история
console.log('\n=== 3. version ↔ История изменений ===');
for (const f of fs.readdirSync(SPECS_DIR).sort()) {
  if (!f.endsWith('.md')) continue;
  if (META_SPECS.has(f)) continue;
  const content = readSpec(f);
  const version = frontmatter(content, 'version');
  const latest = latestHistoryVersion(content);
  if (!version || !latest) continue; // нет данных — пропуск (структура уже проверена)
  if (version !== latest) {
    err(`${f}: version=${version}, но последняя запись истории=${latest}`);
  } else {
    ok(`${f}: version=${version} ✓`);
  }
}

// 4. Обратное покрытие (spec → src)
console.log('\n=== 4. Обратное покрытие (spec → src) ===');
for (const f of fs.readdirSync(SPECS_DIR).sort()) {
  if (!f.endsWith('.md')) continue;
  if (META_SPECS.has(f)) continue;
  if (REVERSE_EXEMPT_SPECS.has(f)) { ok(`${f}: не-.ts компонент (фронтенд) — разрешено`); continue; }
  const content = readSpec(f);
  const status = frontmatter(content, 'status');
  if (REVERSE_EXEMPT_STATUS.has(status)) {
    ok(`${f}: status=${status} (без кода — разрешено)`);
    continue;
  }
  if (specHasSrc.has(f)) ok(`${f} → код есть`);
  else err(`${f}: спека без src-файла (orphan). Пометить status: planned|deprecated или удалить.`);
}

console.log(`\n=== Результат: ${errors} ошибок ===`);
process.exit(errors ? 1 : 0);
