#!/usr/bin/env node
// Приёмка локального поиска: три бэкенда, один набор запросов, один прогон.
//
// Правки по ревью deepseek-v4-pro (правки до использования):
//   1. baseline — не «подстрока всей фразы» (чучело, 0% по построению), а grep-AND по словам;
//   2. OR-бэкенд без буста путей (буст был выбран на глаз и подыгрывал src);
//   3. эталон — все файлы, где символ объявлен; отдельно считается strict по первичному файлу;
//   4. интервалы Уилсона: на 30 запросах разница в 10 п.п. — шум;
//   5. негативные считаются числом: доля запросов без ответа, где выдача непустая;
//   6. sha256 queries.json печатается — видно, что эталон не менялся после прогона;
//   7. из корпуса исключается вся папка scripts/acceptance (файлы запросов содержат их же слова).
//
// Запуск: node scripts/acceptance/run.js [каталог репозитория] [--json]

'use strict';

const crypto = require('crypto');
const fs = require('fs');
const os = require('os');
const path = require('path');

// MODULE_ROOT — репозиторий расширения (из него берём out/ и dist/sqlite),
// CORPUS — то, что индексируем (может быть чужим репозиторием без сборки).
const MODULE_ROOT = path.resolve(path.join(__dirname, '..', '..'));
const corpusArg = process.argv.find((arg) => arg.startsWith('--corpus='));
const ROOT = corpusArg ? path.resolve(corpusArg.slice('--corpus='.length)) : MODULE_ROOT;
const queriesArg = process.argv.find((arg) => arg.startsWith('--queries='));
const QUERY_FILE = queriesArg ? path.resolve(queriesArg.slice('--queries='.length)) : path.join(__dirname, 'queries.json');
const AS_JSON = process.argv.includes('--json');
const SKIP = new Set(['node_modules', '.git', 'dist', 'out', 'coverage', '.vscode-test']);
const MAX_BYTES = 512 * 1024;
/** Дублирует порог инструмента (ToolDefinitions.MIN_MATCHED_TOKENS): приёмка меряет то, что видит агент. */
const MIN_MATCHED = 2;
const RAW = fs.readFileSync(QUERY_FILE);
const QUERIES = JSON.parse(RAW.toString('utf-8'));

const STOP = new Set(['где', 'как', 'что', 'чем', 'для', 'при', 'это', 'или', 'ещё', 'еще', 'нужно', 'будет', 'его', 'она', 'они', 'the', 'and', 'of', 'in', 'to', 'is', 'a']);
function words(query) {
  return Array.from(new Set((query.toLowerCase().match(/[a-zа-яё0-9_]{3,}/gu) ?? []).filter((w) => !STOP.has(w)))).slice(0, 12);
}

function walk(dir, acc) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (SKIP.has(entry.name)) continue;
    const abs = path.join(dir, entry.name);
    if (entry.isDirectory()) walk(abs, acc);
    else if (entry.isFile() && !entry.name.endsWith('.vsix')) acc.push(abs);
  }
  return acc;
}

const files = walk(ROOT, [])
  .map((abs) => path.relative(ROOT, abs).replace(/\\/g, '/'))
  .filter((rel) => !rel.startsWith('scripts/acceptance/'));

const texts = new Map();
function text(rel) {
  if (texts.has(rel)) return texts.get(rel);
  let value = null;
  try {
    const abs = path.join(ROOT, rel);
    const stat = fs.statSync(abs);
    if (stat.size <= MAX_BYTES) {
      const buf = fs.readFileSync(abs);
      if (!buf.subarray(0, 4096).includes(0)) value = buf.toString('utf-8').toLowerCase();
    }
  } catch {
    value = null;
  }
  texts.set(rel, value);
  return value;
}

function countOccurrences(haystack, needle) {
  let count = 0;
  let index = haystack.indexOf(needle);
  while (index !== -1 && count < 20) {
    count += 1;
    index = haystack.indexOf(needle, index + needle.length);
  }
  return count;
}

/** Базовая линия без индекса: файл должен содержать ВСЕ слова запроса (grep по каждому слову). */
function backendGrepAnd(query, limit = 5) {
  const tokens = words(query);
  if (tokens.length === 0) return [];
  const scored = [];
  for (const rel of files) {
    const body = text(rel);
    if (!body) continue;
    let total = 0;
    let all = true;
    for (const token of tokens) {
      const count = countOccurrences(body, token);
      if (count === 0) {
        all = false;
        break;
      }
      total += count;
    }
    if (all) scored.push({ path: rel, score: total });
  }
  return scored.sort((a, b) => b.score - a.score).slice(0, limit);
}

/** Альтернатива без индекса: любое слово, ранг по числу совпадений. Буста путей нет — он был подгонкой. */
function backendKeywordOr(query, limit = 5) {
  const tokens = words(query);
  const scored = [];
  for (const rel of files) {
    const body = text(rel);
    if (!body) continue;
    let total = 0;
    for (const token of tokens) total += countOccurrences(body, token);
    if (total > 0) scored.push({ path: rel, score: total });
  }
  return scored.sort((a, b) => b.score - a.score).slice(0, limit);
}

async function buildIndexBackend() {
  const { SearchIndexStore } = require(path.join(MODULE_ROOT, 'out/src/shared/SearchIndex.js'));
  const { SearchIndexer } = require(path.join(MODULE_ROOT, 'out/src/shared/SearchIndexer.js'));
  // sqlite-wasm грузим напрямую: IndexService тянет `vscode`, а приёмка идёт в обычном Node
  const dynamicImport = new Function('specifier', 'return import(specifier)');
  const { pathToFileURL } = require('url');
  const mod = await dynamicImport(pathToFileURL(path.join(MODULE_ROOT, 'dist', 'sqlite', 'node.mjs')).href);
  const sqlite3 = typeof mod.default === 'function' ? await mod.default() : mod;

  const store = new SearchIndexStore(sqlite3, { indexPath: path.join(os.tmpdir(), `llma-acc-${process.pid}.sqlite`) });
  if (!(await store.init())) throw new Error('индекс не поднялся');
  const adapter = {
    async listFiles() {
      return files.map((rel) => {
        const stat = fs.statSync(path.join(ROOT, rel));
        return { relPath: rel, size: stat.size, mtime: Math.round(stat.mtimeMs) };
      });
    },
    async readFile(rel) {
      return new Uint8Array(fs.readFileSync(path.join(ROOT, rel)));
    },
    async readGitignore() {
      const file = path.join(ROOT, '.gitignore');
      return fs.existsSync(file) ? fs.readFileSync(file, 'utf-8').split('\n') : [];
    },
  };
  const started = Date.now();
  const stats = await new SearchIndexer(store, adapter).fullBuild();
  return {
    build: { files: stats.indexed, ms: Date.now() - started },
    search: (query, limit = 5) => store.search(query, limit).map((hit) => ({ path: hit.path, score: hit.rank })),
    // То же, что делает инструмент: слабые попадания (меньше двух совпавших слов) не считаются ответом
    searchFiltered: (query, limit = 5) =>
      store
        .search(query, limit)
        .filter((hit) => hit.matched >= MIN_MATCHED)
        .map((hit) => ({ path: hit.path, score: hit.rank })),
    close: () => store.close(),
  };
}

/** Интервал Уилсона: на малых выборках нормальное приближение врёт. */
function wilson(successes, total, z = 1.96) {
  if (total === 0) return [0, 0];
  const p = successes / total;
  const denominator = 1 + (z * z) / total;
  const centre = p + (z * z) / (2 * total);
  const spread = z * Math.sqrt((p * (1 - p)) / total + (z * z) / (4 * total * total));
  return [Math.max(0, (centre - spread) / denominator), Math.min(1, (centre + spread) / denominator)];
}

function evaluate(hits, item) {
  const paths = hits.map((hit) => hit.path);
  const anyIndex = paths.findIndex((p) => item.expect.includes(p));
  const strictIndex = item.primary ? paths.indexOf(item.primary) : anyIndex;
  return {
    anyRank: anyIndex >= 0 ? anyIndex + 1 : 0,
    strictRank: strictIndex >= 0 ? strictIndex + 1 : 0,
    top: paths.slice(0, 3),
  };
}

(async () => {
  const index = await buildIndexBackend();
  const backends = {
    grepAnd: (q) => backendGrepAnd(q),
    keywordOr: (q) => backendKeywordOr(q),
    index: (q) => index.search(q, 5),
    indexFiltered: (q) => index.searchFiltered(q, 5),
  };

  const positives = QUERIES.queries.filter((q) => !q.negative);
  const negatives = QUERIES.queries.filter((q) => q.negative);
  const metrics = {};

  for (const [name, run] of Object.entries(backends)) {
    // --lang=en переключает на английскую формулировку (поле queryEn), если она есть:
    // так видно, дело в индексе или в языке запроса относительно языка кода
    const useEn = process.argv.includes('--lang=en');
    const ask = (item) => run(useEn && item.queryEn ? item.queryEn : item.query);
    const rows = positives.map((item) => ({ id: item.id, item, ...evaluate(ask(item), item) }));
    const n = rows.length;
    const anyHits = rows.filter((r) => r.anyRank > 0 && r.anyRank <= 5).length;
    const strictHits = rows.filter((r) => r.strictRank > 0 && r.strictRank <= 5).length;
    const mrr = rows.reduce((sum, r) => sum + (r.anyRank ? 1 / r.anyRank : 0), 0) / n;
    const p1 = rows.filter((r) => r.anyRank === 1).length / n;

    const negRows = negatives.map((item) => {
      const hits = ask(item);
      const top = hits[0];
      const allWords = top ? words(item.query).every((token) => !text(top.path) || text(top.path).includes(token)) : false;
      return { id: item.id, query: item.query, top: hits.slice(0, 3).map((h) => h.path), answered: Boolean(top), strongMatch: Boolean(top) && allWords };
    });

    metrics[name] = {
      recall5: anyHits / n,
      recall5CI: wilson(anyHits, n),
      recall5Strict: strictHits / n,
      mrr,
      p1,
      negativeAnswered: negRows.filter((r) => r.answered).length / negatives.length,
      negativeStrong: negRows.filter((r) => r.strongMatch).length / negatives.length,
      rows,
      negRows,
    };
  }
  if (process.argv.includes('--calibrate')) {
    // Калибровка порога «нет ответа»: смотрим, чем отличается топ-1 у вопросов с ответом
    // и у вопросов, ответа на которые в коде нет. Нужны две величины: ранг bm25 и число
    // различных слов запроса, реально найденных в файле.
    const rows = [];
    for (const item of QUERIES.queries) {
      const hits = index.search(item.query, 1);
      const top = hits[0];
      const body = top ? text(top.path) ?? '' : '';
      const matched = top ? words(item.query).filter((token) => body.includes(token)).length : 0;
      rows.push({ id: item.id, negative: Boolean(item.negative), rank: top ? top.score : 0, matched, top: top ? top.path : null });
    }
    console.log('id   neg  bm25-ранг   совпало слов  файл');
    for (const row of rows) {
      console.log(`${row.id.padEnd(4)} ${row.negative ? 'да ' : 'нет'}  ${row.rank.toFixed(2).padStart(9)}   ${String(row.matched).padStart(2)}           ${row.top ?? '—'}`);
    }
    index.close();
    return;
  }

  index.close();

  if (AS_JSON) {
    const slim = {};
    for (const [name, m] of Object.entries(metrics)) slim[name] = { ...m, rows: undefined, negRows: undefined };
    console.log(JSON.stringify({ repo: ROOT, corpus: files.length, queriesSha256: crypto.createHash('sha256').update(RAW).digest('hex'), indexBuild: index.build, metrics: slim }, null, 2));
    return;
  }

  const pct = (x) => `${Math.round(x * 100)}%`;
  const ci = ([lo, hi]) => `[${Math.round(lo * 100)}; ${Math.round(hi * 100)}]`;
  console.log(`\nКорпус: ${files.length} файлов; запросов с эталоном: ${positives.length}, негативных: ${negatives.length}`);
  console.log(`queries.json sha256: ${crypto.createHash('sha256').update(RAW).digest('hex').slice(0, 16)}…  сборка индекса: ${index.build.files} файлов за ${index.build.ms} мс\n`);
  console.log('бэкенд      recall@5 (95% ДИ)        strict@5   MRR    P@1   негативных с ответом');
  for (const name of ['grepAnd', 'keywordOr', 'index', 'indexFiltered']) {
    const m = metrics[name];
    console.log(
      `${name.padEnd(11)} ${pct(m.recall5).padStart(4)} ${ci(m.recall5CI).padEnd(12)} ${pct(m.recall5Strict).padStart(7)}   ` +
        `${m.mrr.toFixed(2)}   ${pct(m.p1).padStart(4)}   ${pct(m.negativeAnswered).padStart(5)} (уверенно ${pct(m.negativeStrong)})`,
    );
  }

  console.log('\nПромахи индекса (эталон не в топ-5):');
  const misses = metrics.index.rows.filter((r) => r.anyRank === 0);
  if (misses.length === 0) console.log('  нет');
  for (const miss of misses) console.log(`  ${miss.id} «${miss.item.query}» → ${miss.top.join(', ') || 'пусто'}`);

  console.log('\nНегативные (вопрос без ответа в коде) — что выдал индекс:');
  for (const row of metrics.index.negRows) {
    console.log(`  ${row.id} «${row.query}» → ${row.top.join(', ') || 'пусто'}${row.strongMatch ? '  ← все слова совпали' : ''}`);
  }
})().catch((error) => {
  console.error(error && error.stack ? error.stack : String(error));
  process.exit(2);
});
