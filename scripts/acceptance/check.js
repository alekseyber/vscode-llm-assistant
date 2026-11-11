#!/usr/bin/env node
// Гейт приёмки поиска для CI: числа из run.js --json сравниваются с порогами.
//
// Пороги — из ревью deepseek-v4-pro (11.11): recall@5 ≥ 70%, strict@5 ≥ 45%, MRR ≥ 0.45,
// P@1 ≥ 30%, ни одного уверенного совпадения на негативных запросах.
// Числа привязаны к фиксированному queries.json (sha256 печатается), иначе они бессмысленны.

'use strict';

const { execFileSync } = require('child_process');
const path = require('path');

const THRESHOLDS = { recall5: 0.7, recall5Strict: 0.45, mrr: 0.45, p1: 0.3, negativeStrong: 0 };

const raw = execFileSync('node', [path.join(__dirname, 'run.js'), path.join(__dirname, '..', '..'), '--json'], {
  encoding: 'utf-8',
});
const report = JSON.parse(raw);
const index = report.metrics.index;

const failures = [];
for (const [key, min] of Object.entries(THRESHOLDS)) {
  const value = index[key];
  if (typeof value !== 'number') {
    failures.push(`${key}: метрика не посчитана`);
  } else if (value < min) {
    failures.push(`${key} = ${value.toFixed(2)}, порог ${min}`);
  }
}
console.log(
  `[acceptance] corpus=${report.corpus} queries.sha256=${report.queriesSha256.slice(0, 16)}… ` +
    `recall@5=${index.recall5.toFixed(2)} strict@5=${index.recall5Strict.toFixed(2)} ` +
    `MRR=${index.mrr.toFixed(2)} P@1=${index.p1.toFixed(2)} негативных с уверенным совпадением=${index.negativeStrong.toFixed(2)}`,
);
if (failures.length > 0) {
  console.error('[acceptance] ❌ регресс приёмки поиска:');
  for (const failure of failures) console.error('  - ' + failure);
  process.exit(1);
}
console.log('[acceptance] ✅ метрики не ниже порогов');
