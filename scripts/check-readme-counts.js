#!/usr/bin/env node
// Сверка чисел тестов в README с фактическим прогоном.
//
// Зачем: числа в README («611 mocked», «42 e2e») стухают при каждом релизе,
// и заметить это можно только вопросом «а доки актуальны?». Проверка в CI
// валит сборку, если README разошёлся с прогоном.
//
// Использование:
//   node scripts/check-readme-counts.js --mocked=611 [--e2e=42]
//   node scripts/check-readme-counts.js            # только проверить, что шаблоны на месте
//
// Коды выхода: 0 — совпало, 1 — расхождение или шаблон в README не найден.

'use strict';

const fs = require('fs');
const path = require('path');

const README = path.join(__dirname, '..', 'README.md');

/** Шаблоны, которые обязаны быть в README. Если шаблон пропал — проверка ослепла. */
const PATTERNS = {
  mockedStars: { regex: /\*\*(\d+)\*\* mocked-тестов/, what: 'число mocked-тестов (**N** mocked-тестов)' },
  mockedCommand: { regex: /Тесты без VS Code \((\d+) шт\.\)/, what: 'число в команде npm run test:mocked' },
  e2e: { regex: /Extension Host \(\*\*(\d+)\*\* теста/, what: 'число e2e в разделе про тесты' },
};

function parseArgs(argv) {
  const args = {};
  for (const raw of argv.slice(2)) {
    const match = /^--([a-z]+)=(\d+)$/.exec(raw);
    if (match) args[match[1]] = Number(match[2]);
  }
  return args;
}

function main() {
  const args = parseArgs(process.argv);
  const readme = fs.readFileSync(README, 'utf-8');
  const errors = [];

  // 1. Шаблоны на месте
  const found = {};
  for (const [key, { regex, what }] of Object.entries(PATTERNS)) {
    const match = regex.exec(readme);
    if (!match) {
      errors.push(`в README не найдено ${what} — проверка ослепла, шаблон изменён?`);
      continue;
    }
    found[key] = Number(match[1]);
  }

  // 2. Внутренняя согласованность README (оба упоминания mocked-тестов)
  if (found.mockedStars !== undefined && found.mockedCommand !== undefined && found.mockedStars !== found.mockedCommand) {
    errors.push(
      `README сам себе противоречит по mocked-тестам: «**${found.mockedStars}** mocked-тестов» и «(${found.mockedCommand} шт.)»`,
    );
  }

  // 3. Сверка с фактическим прогоном
  if (args.mocked !== undefined && found.mockedStars !== undefined && args.mocked !== found.mockedStars) {
    errors.push(`mocked-тестов по факту ${args.mocked}, в README ${found.mockedStars}`);
  }
  if (args.e2e !== undefined && found.e2e !== undefined && args.e2e !== found.e2e) {
    errors.push(`e2e по факту ${args.e2e}, в README ${found.e2e}`);
  }

  if (errors.length > 0) {
    console.error('[README-CN] ❌ ' + errors.join('; '));
    console.error(
      '[README-CN] Обнови числа в README: mocked — «**N** mocked-тестов» и «(N шт.)», e2e — «Extension Host (**N** теста)».',
    );
    process.exit(1);
  }

  const parts = [];
  if (args.mocked !== undefined) parts.push(`mocked=${args.mocked}`);
  if (args.e2e !== undefined) parts.push(`e2e=${args.e2e}`);
  console.log(`[README-CN] ✅ README совпадает${parts.length ? ` (${parts.join(', ')})` : ' — шаблоны на месте'}`);
}

main();
