#!/usr/bin/env node
// Мутационная проверка: способен ли набор юнит-тестов упасть от изменения поведения.
//
// Зачем: «тест есть» и «поведение проверено» — разные вещи. Число тестов и их названия ничего
// не доказывают, а тесты пишет тот же автор, что и код. Метод простой: правим одну строку,
// собираем, гоняем тесты. Если мутация компилируется, а тесты зелёные — поведение не покрыто.
//
// Обязательное условие: мутация, которая не компилируется, считается неприменимой и
// пропускается. Иначе «зелёный» прогон означал бы лишь то, что тесты шли на старом out/.
//
// Запуск: node scripts/mutation-check.js [--only=ID,ID] [--json]
// Код выхода: 1 — есть мутации, которых тесты не заметили.

'use strict';

const { execFileSync } = require('child_process');
const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const CONFIG = path.join(ROOT, 'test', 'mutations.json');
const TSC = path.join(ROOT, 'node_modules', 'typescript', 'bin', 'tsc');

function run(command, args, options = {}) {
  try {
    const stdout = execFileSync(command, args, { cwd: ROOT, encoding: 'utf-8', stdio: 'pipe', ...options });
    return { code: 0, stdout };
  } catch (error) {
    return {
      code: error.status ?? 1,
      stdout: `${error.stdout ?? ''}${error.stderr ?? ''}`,
    };
  }
}

function compile() {
  return run(process.execPath, [TSC, '-p', 'tsconfig.test.json']);
}

function unitTests() {
  const result = run(process.execPath, [path.join(ROOT, 'test', 'run-mocked.js')]);
  const passing = /(\d+) passing/.exec(result.stdout);
  const failing = /(\d+) failing/.exec(result.stdout);
  return {
    code: result.code,
    passing: passing ? Number(passing[1]) : 0,
    failing: failing ? Number(failing[1]) : 0,
    output: result.stdout,
  };
}

function main() {
  const only = process.argv.find((arg) => arg.startsWith('--only='));
  const asJson = process.argv.includes('--json');
  const wanted = only ? new Set(only.slice('--only='.length).split(',').map((s) => s.trim())) : undefined;
  const config = JSON.parse(fs.readFileSync(CONFIG, 'utf-8'));

  const baseline = unitTests();
  if (baseline.code !== 0) {
    console.error('[mutation] база красная — мутации бессмысленны, сначала почините тесты');
    console.error(baseline.output.slice(-800));
    process.exit(2);
  }

  const results = [];
  for (const mutation of config.mutations) {
    if (wanted && !wanted.has(mutation.id)) continue;
    const file = path.join(ROOT, mutation.file);
    const original = fs.readFileSync(file, 'utf-8');
    if (!original.includes(mutation.from)) {
      results.push({ ...mutation, verdict: 'not-applied', detail: 'строка для мутации не найдена' });
      continue;
    }

    let verdict;
    let detail = '';
    try {
      fs.writeFileSync(file, original.replace(mutation.from, mutation.to), 'utf-8');
      const compiled = compile();
      if (compiled.code !== 0) {
        verdict = 'not-compiled';
        detail = 'мутация не компилируется — поведение не проверялось';
      } else {
        const tests = unitTests();
        verdict = tests.failing > 0 ? 'caught' : 'missed';
        detail = `${tests.passing} passing, ${tests.failing} failing`;
      }
    } finally {
      fs.writeFileSync(file, original, 'utf-8');
    }
    results.push({ ...mutation, verdict, detail });
  }

  // Возвращаем сборку в исходное состояние: следующий шаг (сборка пакета) должен видеть чистый код
  compile();

  const missed = results.filter((row) => row.verdict === 'missed');
  if (asJson) {
    console.log(JSON.stringify({ baseline: { passing: baseline.passing }, results }, null, 2));
  } else {
    console.log(`\n[mutation] база: ${baseline.passing} passing\n`);
    console.log('id                    вердикт        что сделали');
    for (const row of results) {
      const mark = row.verdict === 'caught' ? '✅ поймана' : row.verdict === 'missed' ? '❌ не поймана' : `⚠️ ${row.verdict}`;
      console.log(`${row.id.padEnd(21)} ${mark.padEnd(14)} ${row.label}${row.detail ? ` — ${row.detail}` : ''}`);
    }
    console.log(`\n[mutation] поймано ${results.length - missed.length} из ${results.length}`);
    if (missed.length > 0) {
      console.log('[mutation] поведение не покрыто юнит-тестами:');
      for (const row of missed) console.log(`  - ${row.id}: ${row.label}`);
    }
  }

  process.exit(missed.length > 0 ? 1 : 0);
}

main();
