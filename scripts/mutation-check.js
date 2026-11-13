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


/**
 * Ближайшие строки файла к искомому фрагменту: помогает обновить мутацию, когда реализация
 * изменилась и `from` перестал совпадать. Сравнение — по нормализованному тексту (пробелы схлопнуты),
 * расстояние — Левенштейн с ранней отсечкой.
 */
function normalized(text) {
  return String(text).replace(/\s+/g, ' ').trim();
}

function levenshtein(a, b) {
  if (a === b) return 0;
  if (!a.length) return b.length;
  if (!b.length) return a.length;
  let prev = Array.from({ length: b.length + 1 }, (_, i) => i);
  for (let i = 1; i <= a.length; i += 1) {
    const cur = [i];
    for (let j = 1; j <= b.length; j += 1) {
      cur[j] = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
    }
    prev = cur;
  }
  return prev[b.length];
}

/** Кандидаты на замену `from`: до `limit` строк с наименьшим расстоянием. */
function suggestClosestLines(content, from, limit = 3) {
  const needle = normalized(from);
  const lines = String(content).split('\n');
  const scored = [];
  lines.forEach((line, index) => {
    const text = normalized(line);
    if (!text) return;
    // Первый проход — грубый фильтр по общим словам, иначе Левенштейн по всему файлу дорог
    const firstToken = needle.split(' ')[0];
    if (text.length < 4 && !needle.includes(text)) return;
    if (!firstToken || !text.includes(firstToken)) return;
    // Числовые литералы различают почти одинаковые строки (4096 против 32_768): чем больше
    // общих чисел, тем выше кандидат — иначе выигрывает короткая строка вроде `return undefined;`
    const nums = (str) => new Set((str.match(/\d[\d_]*/g) ?? []).map((n) => n.replace(/_/g, '')));
    const a = nums(needle);
    const b = nums(text);
    // Если в мутации есть числа, а в строке их нет — это не «похожая строка», а другая логика
    if (a.size > 0 && b.size === 0) return;
    const union = new Set([...a, ...b]);
    const overlap = union.size === 0 ? 0 : [...a].filter((n) => b.has(n)).length / union.size;
    const score = levenshtein(text, needle) - overlap * 40;
    if (Number.isFinite(score)) scored.push({ line: index + 1, text: line.trim(), score });
  });
  scored.sort((a, b) => a.score - b.score);
  return scored.slice(0, limit);
}

const BACKUP_DIR = path.resolve(__dirname, '..', 'tmp', 'mutation-backup');

/** Сохранить исходник до мутации: восстановление возможно даже после жёсткого убийства процесса. */
function backupPath(file) {
  // Повторяем структуру каталогов: никаких склеек имён и коллизий вида `a__b` vs `a/b`
  const rel = path.relative(path.resolve(__dirname, '..'), file);
  return path.join(BACKUP_DIR, `${rel}.bak`);
}

function writeBackup(file, content) {
  const target = backupPath(file);
  fs.mkdirSync(path.dirname(target), { recursive: true });
  fs.writeFileSync(target, content, 'utf-8');
}

function clearBackup(file) {
  const bak = backupPath(file);
  if (fs.existsSync(bak)) fs.unlinkSync(bak);
}

/** Восстановить всё, что осталось от прерванного прогона. Возвращает список файлов. */
function restoreLeftovers() {
  const restored = [];
  if (!fs.existsSync(BACKUP_DIR)) return restored;
  const walk = (dir) => {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) { walk(full); continue; }
      if (!entry.name.endsWith('.bak')) continue;
      const target = path.join(path.resolve(__dirname, '..'), path.relative(BACKUP_DIR, full).slice(0, -4));
      fs.writeFileSync(target, fs.readFileSync(full, 'utf-8'), 'utf-8');
      fs.unlinkSync(full);
      restored.push(path.relative(path.resolve(__dirname, '..'), target));
    }
  };
  walk(BACKUP_DIR);
  return restored;
}


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
  if (process.argv.includes('--restore-only')) {
    const left = restoreLeftovers();
    console.log(left.length ? `[mutation] восстановлено: ${left.join(', ')}` : '[mutation] нечего восстанавливать');
    process.exit(0);
  }
  // Обрыв прошлого прогона: возвращаем файлы из бэкапа, иначе мутация остаётся в дереве
  const restored = restoreLeftovers();
  if (restored.length) {
    console.log(`[mutation] восстановлено после прерванного прогона: ${restored.join(', ')}`);
  }
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
      const hints = suggestClosestLines(original, mutation.from);
      results.push({
        ...mutation,
        verdict: 'not-applied',
        detail: 'строка для мутации не найдена — реализация изменилась, обновите `from` в test/mutations.json',
        hints,
      });
      continue;
    }

    let verdict;
    let detail = '';
    try {
      // Бэкап на диск: если процесс убьют (перезагрузка гейтвея, таймаут), восстановление
      // при следующем запуске вернёт файл — `finally` в убитом процессе не выполняется
      writeBackup(file, original);
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
      clearBackup(file);
    }
    results.push({ ...mutation, verdict, detail });
  }

  // Возвращаем сборку в исходное состояние: следующий шаг (сборка пакета) должен видеть чистый код
  compile();

  const missed = results.filter((row) => row.verdict === 'missed');
  const inapplicable = results.filter(
    (row) => row.verdict !== 'missed' && row.verdict !== 'caught',
  );
  const caught = results.filter((row) => row.verdict === 'caught').length;
  if (asJson) {
    console.log(JSON.stringify({ baseline: { passing: baseline.passing }, results }, null, 2));
  } else {
    console.log(`\n[mutation] база: ${baseline.passing} passing\n`);
    console.log('id                    вердикт        что сделали');
    for (const row of results) {
      const mark = row.verdict === 'caught' ? '✅ поймана' : row.verdict === 'missed' ? '❌ не поймана' : `⚠️ ${row.verdict}`;
      console.log(`${row.id.padEnd(21)} ${mark.padEnd(14)} ${row.label}${row.detail ? ` — ${row.detail}` : ''}`);
    }
    console.log(
      `\n[mutation] поймано ${caught} из ${results.length}` +
        (inapplicable.length > 0
          ? `, неприменимых ${inapplicable.length} (${inapplicable.map((r) => r.id).join(', ')})`
          : ''),
    );
    if (inapplicable.length > 0) {
      // Без подсказки такой прогон читается как «тесты виноваты», хотя строка просто переехала
      console.log('[mutation] неприменимые мутации — обновите `from` в test/mutations.json:');
      for (const row of inapplicable) {
        console.log(`  - ${row.id} (${row.file}):`);
        for (const hint of row.hints ?? []) {
          console.log(`      строка ${hint.line}: ${hint.text.slice(0, 140)}`);
        }
        if (!row.hints || row.hints.length === 0) console.log('      похожих строк не нашлось — проверьте, что правило ещё существует');
      }
    }
    if (missed.length > 0) {
      console.log('[mutation] поведение не покрыто юнит-тестами:');
      for (const row of missed) console.log(`  - ${row.id}: ${row.label}`);
    }
  }

  process.exit(missed.length > 0 ? 1 : 0);
}

// Экспорт для юнит-тестов: подсказки по неприменимым мутациям проверяются без запуска прогона
module.exports = { suggestClosestLines, levenshtein };

if (require.main === module) main();
