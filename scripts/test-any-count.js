#!/usr/bin/env node
// Бюджет `as any` в тестах: ратчет по файлам, счёт по AST TypeScript.
//
// Почему AST, а не регулярка: комментарии, строки и regex-литералы дают ложные срабатывания,
// а `as any[]` и `(x as any[])[i]` — пропуски. AST считает ровно то, что видит компилятор.
//
// Бюджет — карта «файл → число». Гейт валит сборку, если выросла сумма или любой существующий
// файл. Новый файл или рост требуют причины: `--reason "путь.ts: почему"` (или общий `--reason`),
// причина с датой пишется в `reasons` и печатается рядом с предупреждением.
//
// Запуск:
//   node scripts/test-any-count.js
//   node scripts/test-any-count.js --update [--reason "…"]
//   node scripts/test-any-count.js --json

'use strict';

const fs = require('fs');
const path = require('path');
const ts = require('typescript');

const ROOT = path.resolve(__dirname, '..');
const TEST_DIR = path.join(ROOT, 'test');
const BUDGET = path.join(TEST_DIR, 'any-budget.json');

function walk(dir, out = []) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      if (entry.name === 'node_modules' || entry.name === 'out') continue;
      walk(full, out);
      continue;
    }
    if (entry.name.endsWith('.ts') && !entry.name.endsWith('.tmp.ts')) out.push(full);
  }
  return out;
}

/** Снять скобки: `(x as any).field` — expression это ParenthesizedExpression, не AsExpression. */
function unwrap(node) {
  let current = node;
  while (current && ts.isParenthesizedExpression(current)) current = current.expression;
  return current;
}

/** Тип `any`, включая `any[]` и `readonly any[]`. */
function isAnyType(node) {
  if (!node) return false;
  if (node.kind === ts.SyntaxKind.AnyKeyword) return true;
  if (ts.isArrayTypeNode(node)) return isAnyType(node.elementType);
  if (ts.isTypeOperatorNode(node)) return isAnyType(node.type);
  return false;
}

/** Ключ-строка, начинающаяся с `_`, `private` или `#`. */
function isPrivateKey(argument) {
  if (!argument) return false;
  if (ts.isStringLiteral(argument) || ts.isNoSubstitutionTemplateLiteral(argument)) {
    return /^(_|private|#)/.test(argument.text);
  }
  return false;
}

function analyseFile(full, rel) {
  const source = ts.createSourceFile(rel, fs.readFileSync(full, 'utf-8'), ts.ScriptTarget.Latest, true);
  let casts = 0;
  let doubleCasts = 0;
  const internalAccess = [];
  const privateKeys = [];
  const lineOf = (node) => source.getLineAndCharacterOfPosition(node.getStart(source)).line + 1;

  const visit = (node) => {
    if (ts.isAsExpression(node) && isAnyType(node.type)) casts += 1;
    // `as unknown as X` — тот же обход типов, но незаметный для основного счётчика
    if (
      ts.isAsExpression(node) &&
      ts.isAsExpression(node.expression) &&
      node.expression.type.kind === ts.SyntaxKind.UnknownKeyword
    ) {
      doubleCasts += 1;
    }

    if (ts.isPropertyAccessExpression(node) || ts.isElementAccessExpression(node)) {
      const base = unwrap(node.expression);
      if (base && ts.isAsExpression(base) && isAnyType(base.type)) {
        internalAccess.push({ file: rel, line: lineOf(node), snippet: node.getText().slice(0, 120) });
      }
    }
    if (ts.isElementAccessExpression(node) && isPrivateKey(node.argumentExpression)) {
      privateKeys.push({ file: rel, line: lineOf(node), snippet: node.getText().slice(0, 120) });
    }
    ts.forEachChild(node, visit);
  };

  ts.forEachChild(source, visit);
  return { casts, doubleCasts, internalAccess, privateKeys };
}

function analyse() {
  const files = {};
  const internalAccess = [];
  const privateKeys = [];
  let doubleCastsTotal = 0;
  for (const full of walk(TEST_DIR)) {
    const rel = path.relative(ROOT, full).split(path.sep).join('/');
    const result = analyseFile(full, rel);
    if (result.casts > 0) files[rel] = result.casts;
    doubleCastsTotal += result.doubleCasts;
    internalAccess.push(...result.internalAccess);
    privateKeys.push(...result.privateKeys);
  }
  return { files, internalAccess, privateKeys, doubleCasts: doubleCastsTotal };
}

function readBudget() {
  try {
    return JSON.parse(fs.readFileSync(BUDGET, 'utf-8'));
  } catch {
    return { files: {}, reasons: {} };
  }
}

/** `--reason "путь.ts: почему"` — на файл; `--reason "почему"` — общая причина. */
function parseReasons(argv) {
  const reasons = new Map();
  const index = argv.indexOf('--reason');
  if (index < 0) return reasons;
  const value = argv[index + 1] || '';
  const match = /^([^:]+\.ts)\s*:\s*(.+)$/.exec(value);
  if (match) reasons.set(match[1].trim(), match[2].trim());
  else reasons.set('*', value.trim());
  return reasons;
}

function main() {
  const update = process.argv.includes('--update');
  const asJson = process.argv.includes('--json');
  const reasonsInput = parseReasons(process.argv);

  const { files, internalAccess, privateKeys, doubleCasts } = analyse();
  const total = Object.values(files).reduce((sum, n) => sum + n, 0);
  const budget = readBudget();
  const budgetFiles = budget.files || {};
  const reasons = budget.reasons || {};
  const budgetTotal = Object.values(budgetFiles).reduce((sum, n) => sum + n, 0);

  const grown = Object.entries(files)
    .filter(([file, count]) => file in budgetFiles && count > budgetFiles[file])
    .map(([file, count]) => ({ file, from: budgetFiles[file], to: count }));
  const added = Object.entries(files)
    .filter(([file]) => !(file in budgetFiles))
    .map(([file, count]) => ({ file, to: count }));
  const reduced = Object.entries(budgetFiles)
    .filter(([file, count]) => (files[file] || 0) < count)
    .map(([file, count]) => ({ file, from: count, to: files[file] || 0 }));

  if (update) {
    const growth = [...grown, ...added];
    const missing = growth.filter((item) => !reasonsInput.has(item.file) && !reasonsInput.has('*'));
    if (missing.length > 0) {
      console.error('[any] рост без причины. Формат: --reason "путь/к/файлу.ts: почему"');
      for (const item of missing) console.error(`    ${item.file}: → ${item.to}`);
      process.exit(1);
    }
    const nextReasons = { ...reasons };
    const today = new Date().toISOString().slice(0, 10);
    for (const item of growth) {
      nextReasons[item.file] = {
        reason: reasonsInput.get(item.file) || reasonsInput.get('*'),
        date: today,
      };
    }
    for (const item of reduced) delete nextReasons[item.file];
    fs.writeFileSync(
      BUDGET,
      `${JSON.stringify(
        {
          note: 'Карта «файл → число as any» (счёт по AST). Рост — только с записью в reasons (причина + дата).',
          updatedAt: today,
          files: Object.fromEntries(Object.entries(files).sort()),
          reasons: nextReasons,
        },
        null,
        2,
      )}\n`,
      'utf-8',
    );
    console.log(`[any] бюджет обновлён: ${total} в ${Object.keys(files).length} файлах`);
    return;
  }

  const unexplainedGrowth = [...grown, ...added].filter((item) => !reasons[item.file]);
  const delta = total - budgetTotal;

  if (asJson) {
    console.log(
      JSON.stringify(
        { total, budgetTotal, delta, grown, added, reduced, unexplainedGrowth, reasons, internalAccess, privateKeys },
        null,
        2,
      ),
    );
  } else {
    console.log(`[any] сейчас ${total}, бюджет ${budgetTotal} (дельта ${delta >= 0 ? '+' : ''}${delta})`);
    if (reduced.length > 0) {
      const saved = reduced.reduce((sum, r) => sum + r.from - r.to, 0);
      console.log(`[any] ✅ снижено на ${saved} в ${reduced.length} файлах`);
    }
    const describe = (text, file) => {
      const entry = reasons[file];
      const suffix = entry ? ` — причина: ${entry.reason} (${entry.date})` : '';
      console.log(`[any] ${entry ? '⚠️' : '❌'} ${text}${suffix}`);
    };
    for (const item of grown) describe(`${item.file}: ${item.from} → ${item.to}`, item.file);
    for (const item of added) describe(`${item.file}: новый файл, +${item.to}`, item.file);
    if (privateKeys.length > 0) {
      console.log(`[any] ⚠️ приватных ключей: ${privateKeys.length}`);
      for (const hit of privateKeys.slice(0, 5)) console.log(`    ${hit.file}:${hit.line} ${hit.snippet}`);
    }
    console.log(`[any] ⚠️ обращений к свойствам через приведение: ${internalAccess.length} (см. --json)`);
    console.log(`[any] ⚠️ двойных приведений «as unknown as»: ${doubleCasts} — видимость, не гейт`);
    for (const hit of internalAccess.slice(0, 5)) console.log(`    ${hit.file}:${hit.line} ${hit.snippet}`);
  }

  if (unexplainedGrowth.length > 0) {
    console.log('[any] бюджет превышен без обоснования: npm run any:update -- --reason "путь.ts: почему"');
    process.exit(1);
  }
}

main();
