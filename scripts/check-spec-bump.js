#!/usr/bin/env node
// Pre-commit гейт: изменение src/X.ts требует бампа specs/<Component>.md В ЭТОМ ЖЕ коммите.
//
// Зачем: CI-гейт `SDD Consistency Check` смотрит один коммит (HEAD~1..HEAD) и запускается
// только по путям src/**. Если бамп спеки приезжает следующим коммитом, исходный коммит
// навсегда остаётся красным, а «исправляющий» коммит гейт вообще не видит. Ошибка ловится
// локально, до push, где её ещё можно исправить без переписывания истории.
//
// Маппинг берём из самого воркфлоу (функция spec_for) — один источник правды.

'use strict';

const { execSync } = require('child_process');
const fs = require('fs');
const path = require('path');

const root = path.join(__dirname, '..');
const workflow = path.join(root, '.github', 'workflows', 'sdd-check.yml');

function sh(cmd) {
  return execSync(cmd, { cwd: root, encoding: 'utf-8' }).trim();
}

function specMap() {
  const text = fs.readFileSync(workflow, 'utf-8');
  const map = new Map();
  // Явные пары из case: src/x.ts) echo "specs/Y.md" ;;
  const re = /^\s*(src\/[\w./-]+\.ts)\)\s*echo\s+"(specs\/[\w./-]+\.md)"/gm;
  let m;
  while ((m = re.exec(text)) !== null) map.set(m[1], m[2]);
  return map;
}

/** Запасное правило воркфлоу: `*) echo "specs/$(basename).md"`. */
function specFor(file, map) {
  return map.get(file) ?? `specs/${path.basename(file, '.ts')}.md`;
}

/** Инфраструктура без своей спеки — как SRC_EXEMPT в spec-validate.js и воркфлоу. */
const EXEMPT = new Set([
  'index', 'types', 'extension', 'registerCommands', 'base', 'diff',
  'ContextBuilder', 'GhostTextManager', 'ChatPanel', 'cleanLlmResponse',
]);

const map = specMap();
if (map.size === 0) {
  console.error('[sdd-hook] ❌ не удалось прочитать маппинг src → spec из .github/workflows/sdd-check.yml');
  process.exit(1);
}

const staged = sh('git diff --cached --name-only --diff-filter=ACMR')
  .split('\n')
  .filter(Boolean);

const changedSpecs = new Set(staged.filter((f) => f.startsWith('specs/')));
const violations = [];

for (const file of staged) {
  if (!file.startsWith('src/') || !file.endsWith('.ts')) continue;
  if (EXEMPT.has(path.basename(file, '.ts'))) continue;
  const spec = specFor(file, map);
  if (!fs.existsSync(path.join(root, spec))) continue; // спеки нет — гейт CI тоже пропустит
  if (!changedSpecs.has(spec)) {
    violations.push({ file, spec, reason: 'спека не изменена' });
    continue;
  }
  // Спека в коммите, но версия не бампнута — гейт CI это тоже считает нарушением
  const diff = execSync(`git diff --cached -- ${spec}`, { cwd: root, encoding: 'utf-8' });
  if (!/^\+version:\s*\d+\.\d+\.\d+/m.test(diff)) {
    violations.push({ file, spec, reason: 'версия в спеке не изменена' });
  }
}

if (violations.length > 0) {
  console.error('[sdd-hook] ❌ изменение кода без обновлённой спеки в этом же коммите:');
  for (const v of violations) {
    console.error(`  • ${v.file} → ${v.spec}: ${v.reason}`);
  }
  console.error('');
  console.error('Почему это блокирует коммит: CI-гейт смотрит ОДИН коммит. Если бамп спеки');
  console.error('приедет следующим коммитом, исходный останется красным навсегда.');
  console.error('Что делать: добавить в spec строку истории + бампнуть version, затем git add.');
  process.exit(1);
}

console.log('[sdd-hook] ✅ код и спеки в коммите согласованы');
