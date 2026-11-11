#!/usr/bin/env node
// Гейт приёмки поиска для CI: числа из run.js --json сравниваются с порогами.
//
// Пороги — по правилу «гейт ловит регресс, а не мечту»: значение на зафиксированном эталоне
// минус 10 п.п. На 60 запросах (11.11) инструмент (с порогом слабых попаданий) даёт
// recall@5 68%, strict@5 32%, MRR 0.54, P@1 43%. Отсюда пороги: 58 / 30 / 0.45 / 30.
// Менять их можно только вместе с датой и причиной в этом комментарии, иначе это подгонка.

'use strict';

const { execFileSync } = require('child_process');
const path = require('path');

const THRESHOLDS = { recall5: 0.58, recall5Strict: 0.3, mrr: 0.45, p1: 0.3, negativeStrong: 0 };
/** Меряем то, что видит агент: индекс с порогом слабых попаданий, а не сырую выдачу. */
const BACKEND = 'indexFiltered';

const raw = execFileSync('node', [path.join(__dirname, 'run.js'), path.join(__dirname, '..', '..'), '--json'], {
  encoding: 'utf-8',
});
const report = JSON.parse(raw);
const index = report.metrics[BACKEND];

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
