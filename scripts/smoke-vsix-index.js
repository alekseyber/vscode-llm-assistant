// Смоук: собранный бандл расширения не только грузится, но и реально поднимает индекс
// из распакованного VSIX (нет node_modules — модуль обязан найти dist/sqlite).
//
// Запуск: node scripts/smoke-vsix-index.js <каталог распакованного пакета>
// Код выхода: 0 — индекс создан; 3 — активация упала; 4 — индекс не появился.

'use strict';

const fs = require('fs');
const os = require('os');
const path = require('path');
const Module = require('module');

const packageDir = path.resolve(process.argv[2] || '.');
const workspace = fs.mkdtempSync(path.join(os.tmpdir(), 'vsix-ws-'));
const storage = fs.mkdtempSync(path.join(os.tmpdir(), 'vsix-gs-'));
fs.writeFileSync(
  path.join(workspace, 'cost.ts'),
  'export function calculateCost(tokens: number): number {\n  return tokens * 0.001;\n}\n',
);

const fnProxy = () => new Proxy(function () {}, { get: () => fnProxy(), apply: () => fnProxy() });
const uri = (p) => ({ fsPath: p, scheme: 'file', path: p, toString: () => 'file://' + p, with: (c) => uri(p) });

const disposable = { dispose() {} };
const watcher = {
  onDidChange: () => disposable,
  onDidCreate: () => disposable,
  onDidDelete: () => disposable,
  dispose() {},
};

const base = {
  version: '1.145.2',
  Uri: { file: uri, parse: uri, joinPath: (u, ...parts) => uri(path.join(u.fsPath, ...parts)) },
  RelativePattern: class {
    constructor(baseUri, pattern) {
      this.baseUri = baseUri;
      this.pattern = pattern;
    }
  },
  EventEmitter: class {
    constructor() {
      this.event = () => disposable;
    }
    fire() {}
    dispose() {}
  },
  Disposable: class {
    constructor(fn) {
      this.dispose = fn || (() => {});
    }
  },
  ViewColumn: { One: 1, Two: 2 },
  ConfigurationTarget: { Global: 1, Workspace: 2 },
  ProgressLocation: { Notification: 15 },
  StatusBarAlignment: { Left: 1, Right: 2 },
  ExtensionMode: { Development: 1, Production: 2, Test: 3 },
  workspace: {
    workspaceFolders: [{ uri: uri(workspace), name: 'ws', index: 0 }],
    fs: {
      stat: async (u) => {
        const s = fs.statSync(u.fsPath);
        return { size: s.size, mtime: Math.round(s.mtimeMs), type: 1 };
      },
      readFile: async (u) => new Uint8Array(fs.readFileSync(u.fsPath)),
    },
    findFiles: async () => [uri(path.join(workspace, 'cost.ts'))],
    createFileSystemWatcher: () => watcher,
    getConfiguration: () => ({
      get: (_key, fallback) => fallback,
      has: () => false,
      inspect: () => undefined,
      update: async () => undefined,
    }),
    onDidChangeConfiguration: () => disposable,
    onDidSaveTextDocument: () => disposable,
    onDidChangeTextDocument: () => disposable,
    onDidOpenTextDocument: () => disposable,
    onDidChangeWorkspaceFolders: () => disposable,
    textDocuments: [],
    openTextDocument: async () => ({ getText: () => '', fileName: '', uri: uri('') }),
  },
  window: {
    createWebviewViewProvider: () => disposable,
    registerWebviewViewProvider: () => disposable,
    registerWebviewPanelSerializer: () => disposable,
    showInformationMessage: async () => undefined,
    showWarningMessage: async () => undefined,
    showErrorMessage: async () => undefined,
    showQuickPick: async () => undefined,
    showInputBox: async () => undefined,
    createOutputChannel: () => ({ appendLine() {}, append() {}, show() {}, dispose() {} }),
    createStatusBarItem: () => ({ show() {}, hide() {}, dispose() {}, text: '' }),
    visibleTextEditors: [],
    tabGroups: { all: [] },
    onDidChangeActiveTextEditor: () => disposable,
  },
  commands: { registerCommand: () => disposable, executeCommand: async () => undefined, getCommands: async () => [] },
  languages: {
    createDiagnosticCollection: () => ({ set() {}, delete() {}, dispose() {} }),
    registerCodeLensProvider: () => disposable,
    registerCodeActionsProvider: () => disposable,
    registerInlineCompletionItemProvider: () => disposable,
    registerCompletionItemProvider: () => disposable,
    registerHoverProvider: () => disposable,
    registerDocumentFormattingEditProvider: () => disposable,
    registerCodeActionsProvider: () => disposable,
    createDiagnosticCollection: () => ({ set() {}, delete() {}, dispose() {} }),
    getDiagnostics: () => [],
  },
  env: { appName: 'VS Code', language: 'ru' },
  extensions: { getExtension: () => undefined, all: [] },
};

const vscodeStub = new Proxy(base, { get: (target, prop) => (prop in target ? target[prop] : fnProxy()) });

const originalLoad = Module._load;
Module._load = function (request, parent, isMain) {
  if (request === 'vscode') return vscodeStub;
  return originalLoad.call(this, request, parent, isMain);
};

const state = {
  get: (_key, fallback) => fallback,
  update: async () => undefined,
  keys: () => [],
};

const context = {
  subscriptions: [],
  extensionPath: packageDir,
  extensionUri: uri(packageDir),
  globalStoragePath: storage,
  globalStorageUri: uri(storage),
  logUri: uri(storage),
  storageUri: uri(storage),
  extensionMode: 2,
  asAbsolutePath: (p) => path.join(packageDir, p),
  workspaceState: state,
  globalState: state,
  secrets: { get: async () => undefined, store: async () => undefined, delete: async () => undefined },
  environmentVariableCollection: { replace() {}, clear() {}, append() {}, prepend() {}, delete() {} },
};

const indexDir = path.join(storage, 'index');

function indexFiles() {
  if (!fs.existsSync(indexDir)) return [];
  return fs.readdirSync(indexDir).filter((name) => name.endsWith('.sqlite'));
}

(async () => {
  const bundle = require(path.join(packageDir, 'dist', 'extension.js'));
  await bundle.activate(context);
  // Сборка индекса идёт в фоне — ждём появления файла, а не фиксированное время
  for (let attempt = 0; attempt < 40; attempt += 1) {
    const files = indexFiles();
    if (files.length > 0 && fs.statSync(path.join(indexDir, files[0])).size > 0) {
      console.log('OK');
      process.exit(0);
    }
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  console.error(`индекс не создан (${indexDir}: ${indexFiles().length} файлов)`);
  process.exit(4);
})().catch((error) => {
  console.error(error && error.stack ? error.stack : String(error));
  process.exit(3);
});
