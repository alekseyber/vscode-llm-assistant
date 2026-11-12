#!/usr/bin/env node
// Бюджет `as any` в тестах: ратчет по файлам, а не по одному числу.
//
// Зачем: `as any` в тесте прячет расхождение между тестом и типом. Считать «сколько всего» —
// бессмысленно (одно число ломается на любом слиянии и ничего не говорит о качестве тестов).
// Поэтому бюджет — карта «файл → число»: сумма не растёт и ни один существующий файл не растёт.
// Новый файл с `as any` требует обоснования в бюджете (`reason`), иначе CI красный.
//
// Запуск: node scripts/test-any-count.js [--update] [--json]
//   --update  перезаписать бюджет текущими значениями (осознанное решение, видно в диффе)

'use strict';

const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const TEST_DIR = path.join(ROOT, 'test');
const BUDGET = path.join(TEST_DIR, 'any-budget.json');

// Приватное состояние, к которому тест лезет по строковому ключу: obj['_cache'], obj["private"]
const PRIVATE_ACCESS = /\w+\s*\[\s*['"](?:_|private|#)[\w]*['"]\s*\]/g;

function walk(dir, out = []) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      if (entry.name === 'node_modules' || entry.name === 'out') continue;
      walk(full, out);
      continue;
    }
    if (entry.name.endsWith('.ts')) out.push(full);
  }
  return out;
}

function analyse() {
  const files = {};
  const privateAccess = [];
  for (const full of walk(TEST_DIR).filter((p) => !p.includes('/node_modules/'))) {
    const rel = path.relative(ROOT, full).split(path.sep).join('/');
    const body = fs.readFileSync(full, 'utf-8');
    const count = (body.match(/\bas\s+any\b/g) || []).length;
    const privateHits = body.match(PRIVATE_ACCESS) || [];
    if (count > 0) files[rel] = count;
    for (const hit of privateHits) privateAccess.push({ file: rel, hit });
  }
  return { files, privateAccess };
}

function readBudget() {
  try {
    return JSON.parse(fs.readFileSync(BUDGET, 'utf-8'));
  } catch {
    return { files: {}, reasons: {} };
  }
}

function main() {
  const update = process.argv.includes('--update');
  const asJson = process.argv.includes('--json');
  const { files, privateAccess } = analyse();
  const total = Object.values(files).reduce((sum, n) => sum + n, 0);
  const budget = readBudget();

  if (update) {
    const reasons = budget.reasons || {};
    fs.writeFileSync(
      BUDGET,
      `${JSON.stringify(
        {
          note: 'Карта «файл → число as any». Растёт только с обоснованием в reasons.',
          total,
          files: Object.fromEntries(Object.entries(files).sort()),
          reasons,
        },
        null,
        2,
      )}\n`,
      'utf-8',
    );
    console.log(`[any] бюджет обновлён: ${total} в ${Object.keys(files).length} файлах`);
    return;
  }

  const budgetFiles = budget.files || {};
  const budgetTotal = Object.values(budgetFiles).reduce((sum, n) => sum + n, 0);
  const grown = [];
  const added = [];
  for (const [file, count] of Object.entries(files)) {
    if (!(file in budgetFiles)) {
      added.push({ file, count, reason: budget.reasons?.[file] });
    } else if (count > budgetFiles[file]) {
      grown.push({ file, from: budgetFiles[file], to: count });
    }
  }
  const reduced = Object.entries(budgetFiles)
    .filter(([file, count]) => (files[file] || 0) < count)
    .map(([file, count]) => ({ file, from: count, to: files[file] || 0 }));

  if (asJson) {
    console.log(JSON.stringify({ total, budgetTotal, grown, added, reduced, privateAccess }, null, 2));
  } else {
    console.log(`[any] сейчас ${total}, бюджет ${budgetTotal}`);
    if (reduced.length > 0) {
      const saved = reduced.reduce((sum, r) => sum + r.from - r.to, 0);
      console.log(`[any] ✅ снижено на ${saved} в ${reduced.length} файлах`);
    }
    for (const item of grown) console.log(`[any] ❌ ${item.file}: ${item.from} → ${item.to}`);
    for (const item of added) {
      const verdict = item.reason ? `новая запись с обоснованием: ${item.reason}` : 'новая запись без обоснования';
      console.log(`[any] ${item.reason ? '⚠️' : '❌'} ${item.file}: +${item.count} (${verdict})`);
    }
    if (privateAccess.length > 0) {
      console.log(`[any] ⚠️ доступ к приватному состоянию по ключу: ${privateAccess.length}`);
      for (const hit of privateAccess.slice(0, 10)) console.log(`    ${hit.file}: ${hit.hit}`);
    }
  }

  const failures = grown.length + added.filter((item) => !item.reason).length;
  if (failures > 0) {
    console.log('[any] бюджет превышен — обновите бюджет осознанно: npm run any:update');
    process.exit(1);
  }
}

main();
