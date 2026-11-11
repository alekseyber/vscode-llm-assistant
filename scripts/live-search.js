#!/usr/bin/env node
// Живой прогон поиска агентом на реальном репозитории (P8, приёмка).
//
// Прогоняется НАСТОЯЩИЙ код инструмента `search_files` (out/src/modes/apply/ToolDefinitions.js)
// с настоящим индексом (SearchIndex + SearchIndexer) по файлам проекта. VS Code подменён
// заглушкой, которая читает реальный диск, поэтому проверяется именно то, что увидит агент.
//
// Запуск: node scripts/live-search.js [каталог репозитория]
// Запросы и ожидания — scripts/live-search.queries.json (с датой замера).

'use strict';

const fs = require('fs');
const path = require('path');
const Module = require('module');

const ROOT = path.resolve(process.argv[2] || path.join(__dirname, '..'));
const SKIP = new Set(['node_modules', '.git', 'dist', 'out', 'coverage', '.vscode-test', 'tmp']);

const uri = (p) => ({ fsPath: p, scheme: 'file', path: p, toString: () => 'file://' + p });

function walk(dir, acc) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (SKIP.has(entry.name)) continue;
    const abs = path.join(dir, entry.name);
    if (entry.isDirectory()) walk(abs, acc);
    else if (entry.isFile()) acc.push(abs);
  }
  return acc;
}
const allFiles = walk(ROOT, []);

const disposable = { dispose() {} };
const base = {
  Uri: { file: uri, parse: uri, joinPath: (u, ...p) => uri(path.join(u.fsPath, ...p)) },
  RelativePattern: class {
    constructor(baseUri, pattern) {
      this.baseUri = baseUri;
      this.pattern = pattern;
    }
  },
  workspace: {
    workspaceFolders: [{ uri: uri(ROOT), name: 'vscode-llm-assistant', index: 0 }],
    getWorkspaceFolder: () => ({ uri: uri(ROOT), name: 'vscode-llm-assistant', index: 0 }),
    fs: {
      stat: async (u) => {
        const s = fs.statSync(u.fsPath);
        return { size: s.size, mtime: Math.round(s.mtimeMs), type: 1 };
      },
      readFile: async (u) => new Uint8Array(fs.readFileSync(u.fsPath)),
    },
    findFiles: async () => allFiles.map(uri),
    createFileSystemWatcher: () => ({ onDidChange: () => disposable, onDidCreate: () => disposable, onDidDelete: () => disposable, dispose() {} }),
    getConfiguration: () => ({ get: (_k, d) => d, has: () => false, inspect: () => undefined, update: async () => undefined }),
    onDidChangeConfiguration: () => disposable,
    asRelativePath: (u) => path.relative(ROOT, typeof u === 'string' ? u : u.fsPath),
  },
  window: { showInformationMessage: async () => undefined, createOutputChannel: () => ({ appendLine() {}, dispose() {} }) },
  commands: { registerCommand: () => disposable, executeCommand: async () => undefined },
  env: { appName: 'VS Code' },
};
const vscodeStub = new Proxy(base, { get: (t, p) => (p in t ? t[p] : new Proxy(function () {}, { get: () => () => undefined })) });

const originalLoad = Module._load;
Module._load = function (request, parent, isMain) {
  if (request === 'vscode') return vscodeStub;
  return originalLoad.call(this, request, parent, isMain);
};

const sqliteModule = path.join(ROOT, 'dist', 'sqlite', 'node.mjs');

const { SearchIndexStore } = require(path.join(ROOT, 'out/src/shared/SearchIndex.js'));
const { isIgnored, parseGitignore } = require(path.join(ROOT, 'out/src/shared/gitignore.js'));
const { SearchIndexer } = require(path.join(ROOT, 'out/src/shared/SearchIndexer.js'));
const tools = require(path.join(ROOT, 'out/src/modes/apply/ToolDefinitions.js'));

const adapter = {
  async listFiles() {
    // Реальный vscode.workspace.findFiles учитывает .gitignore и files.exclude;
    // заглушка — нет, поэтому применяем правила здесь, иначе прогон завышает полноту
    const rules = parseGitignore(fs.existsSync(path.join(ROOT, '.gitignore')) ? fs.readFileSync(path.join(ROOT, '.gitignore'), 'utf-8') : '');
    return allFiles.filter((abs) => !isIgnored(path.relative(ROOT, abs).replace(/\\/g, '/'), rules)).map((abs) => {
      const stat = fs.statSync(abs);
      return { relPath: path.relative(ROOT, abs).replace(/\\/g, '/'), size: stat.size, mtime: Math.round(stat.mtimeMs) };
    });
  },
  async readFile(relPath) {
    return new Uint8Array(fs.readFileSync(path.join(ROOT, relPath)));
  },
  async readGitignore() {
    const file = path.join(ROOT, '.gitignore');
    return fs.existsSync(file) ? fs.readFileSync(file, 'utf-8').split('\n') : [];
  },
};

(async () => {
  const { SqliteLoader } = require(path.join(ROOT, 'out/src/shared/IndexService.js'));
  const sqlite3 = await new SqliteLoader(undefined, undefined, sqliteModule).load();
  const store = new SearchIndexStore(sqlite3, { indexPath: path.join(ROOT, 'tmp', 'live-index.sqlite'), onDebug: () => undefined });
  if (!(await store.init())) {
    console.error('индекс не поднялся');
    process.exit(1);
  }
  const started = Date.now();
  const stats = await new SearchIndexer(store, adapter).fullBuild();
  console.log(`[live] проиндексировано ${stats.indexed} файлов за ${Date.now() - started} мс`);

  tools.setIndexSearchProvider({ search: (query, limit = 8) => store.search(query, limit) });
  const searchFiles = tools.createTools().find((t) => t.name === 'search_files');

  // Ожидания сверены с кодом: «лимит бюджета» живёт в ModelRouter, а не в ChatViewProvider
  const queryFile = path.join(__dirname, 'live-search.queries.json');
  const queries = JSON.parse(fs.readFileSync(queryFile, 'utf-8')).queries;

  let hits = 0;
  for (const query of queries) {
    const out = await searchFiles.execute({ pattern: query.pattern });
    const firstLines = out.split('\n').filter((line) => line.trim()).slice(0, 4);
    const hit = out.includes(query.expect);
    if (hit) hits += 1;
    console.log(`\n${hit ? '✓' : '✗'} «${query.pattern}» (ожидание: ${query.expect})`);
    for (const line of firstLines) console.log('   ' + line.slice(0, 140));
  }
  console.log(`\n[live] попаданий в выдаче: ${hits}/${queries.length}`);
  store.close();
  process.exit(hits === queries.length ? 0 : 1);
})().catch((error) => {
  console.error(error);
  process.exit(2);
});
