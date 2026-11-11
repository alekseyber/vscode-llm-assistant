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
  // Форма слова зависит от числа («53 теста», «56 тестов») — принимаем все три,
  // сверка идёт по цифре, а не по окончанию
  e2e: { regex: /Extension Host \(\*\*(\d+)\*\* тест(?:а|ов)?/, what: 'число e2e в разделе про тесты' },
};

function parseArgs(argv) {
  const args = {};
  for (const raw of argv.slice(2).map((a) => a.replace(/[\r\n]/g, ''))) {
    // Значение принимаем как есть и проверяем отдельно: если в него попал \r или текст,
    // молча проигнорировать нельзя — проверка тихо выключилась бы (так и случилось с e2e).
    const match = /^--([a-z0-9]+)=([\s\S]*)$/.exec(raw);
    if (!match) {
      // Не наш аргумент (или мусор) — не молчим: тихо пропущенный аргумент отключает проверку
      if (raw.startsWith('--')) {
        console.error(`[README-CN] ❌ не разобрал аргумент «${raw}»`);
        process.exit(1);
      }
      continue;
    }
    const [, key, value] = match;
    const digits = /^(\d+)$/.exec(value.trim());
    if (!digits) {
      console.error(`[README-CN] ❌ значение --${key} не число: «${value}»`);
      process.exit(1);
    }
    args[key] = Number(digits[1]);
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
