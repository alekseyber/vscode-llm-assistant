#!/usr/bin/env node
// Приёмка P8: настоящий индекс (SearchIndex + SearchIndexer) на стенде p8-bench.
//
// Считает top-5 по 15 запросам и сравнивает с порогом из бэклога: ≥ 8/15 (у подстрочного
// поиска было 4/15 на 820 файлах). Запуск: node scripts/index-bench.js <каталог стенда>

'use strict';

const fs = require('fs');
const os = require('os');
const path = require('path');
const { pathToFileURL } = require('url');

const { SearchIndexStore } = require('../out/src/shared/SearchIndex.js');
const { SearchIndexer } = require('../out/src/shared/SearchIndexer.js');

const benchRoot = path.resolve(process.argv[2] || '/opt/data/reports/p8-bench');
const appDir = path.join(benchRoot, 'app');
const queries = JSON.parse(fs.readFileSync(path.join(benchRoot, 'queries.json'), 'utf8'));

async function loadSqlite() {
  const dynamicImport = new Function('specifier', 'return import(specifier)');
  const local = path.join(__dirname, '..', 'dist', 'sqlite', 'node.mjs');
  const specifier = fs.existsSync(local) ? pathToFileURL(local).href : '@sqlite.org/sqlite-wasm';
  const mod = await dynamicImport(specifier);
  return typeof mod.default === 'function' ? await mod.default() : mod;
}

function diskAdapter(root) {
  return {
    async listFiles() {
      const out = [];
      const walk = (dir) => {
        for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
          const abs = path.join(dir, entry.name);
          if (entry.isDirectory()) {
            walk(abs);
            continue;
          }
          if (!entry.isFile()) continue;
          const stat = fs.statSync(abs);
          out.push({
            relPath: path.relative(root, abs).replace(/\\/g, '/'),
            size: stat.size,
            mtime: Math.round(stat.mtimeMs),
          });
        }
      };
      walk(root);
      return out;
    },
    async readFile(relPath) {
      return new Uint8Array(fs.readFileSync(path.join(root, relPath)));
    },
    async readGitignore() {
      const file = path.join(root, '.gitignore');
      return fs.existsSync(file)
        ? fs.readFileSync(file, 'utf-8').split('\n').map((l) => l.trim()).filter((l) => l && !l.startsWith('#'))
        : [];
    },
  };
}

(async () => {
  const sqlite3 = await loadSqlite();
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'llma-bench-'));
  const store = new SearchIndexStore(sqlite3, { indexPath: path.join(tmp, 'bench.sqlite') });
  if (!(await store.init())) {
    console.error('[bench] индекс не поднялся');
    process.exit(1);
  }

  const started = Date.now();
  const indexer = new SearchIndexer(store, diskAdapter(appDir), { batchSize: 200 });
  const stats = await indexer.fullBuild();
  const buildMs = Date.now() - started;

  let top5 = 0;
  let top1 = 0;
  const rows = [];
  for (const query of queries) {
    const text = query.q ?? query.text ?? query.query ?? String(query);
    // В queries.json ожидаемые файлы перечислены массивом: засчитываем первый найденный
    const expectedList = Array.isArray(query.expect) ? query.expect : [query.expect ?? query.expected ?? query.file];
    const hits = store.search(text, 5).map((hit) => hit.path);
    const rank = hits.findIndex((hit) => expectedList.includes(hit));
    if (rank === 0) top1 += 1;
    if (rank >= 0) top5 += 1;
    rows.push({ query: text, expected: expectedList[0], rank: rank >= 0 ? rank + 1 : '—', hits: hits.slice(0, 3) });
  }

  console.log(
    `[bench] файлов в индексе: ${stats.indexed}, пропущено: ${stats.skipped}, сборка: ${buildMs} мс`,
  );
  for (const row of rows) {
    console.log(`  ${row.rank === '—' ? '✗' : '✓'} ${row.rank}  ${row.query} → ${row.expected}`);
  }
  console.log(`[bench] top-5: ${top5}/${queries.length}, top-1: ${top1}/${queries.length}`);

  store.close();
  fs.rmSync(tmp, { recursive: true, force: true });
  process.exit(top5 >= 8 ? 0 : 1);
})().catch((error) => {
  console.error('[bench]', error);
  process.exit(2);
});
