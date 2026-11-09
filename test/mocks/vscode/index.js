// Mock vscode module для юнит-тестов вне VS Code Extension Host
// Предоставляет минимальный API, необходимый для работы тестов.
// Живёт в git (test/mocks/vscode/) — НЕ в node_modules, чтобы не стирался при npm install.

'use strict';

// --- Uri ---
class Uri {
  constructor(scheme, authority, path, query, fragment) {
    this.scheme = scheme;
    this.authority = authority;
    this.path = path;
    this.query = query;
    this.fragment = fragment;
    this.fsPath = path;
    this._formatted = null;
  }

  static file(p) {
    return new Uri('file', '', p, '', '');
  }

  static joinPath(base, ...segments) {
    return new Uri('file', '', [base.path, ...segments].join('/'), '', '');
  }

  static parse(value) {
    return new Uri('file', '', value, '', '');
  }

  with(change) {
    return this;
  }

  toString() {
    return this._formatted || this.fsPath;
  }

  toJSON() {
    return this.fsPath;
  }
}

// --- Range ---
class Range {
  constructor(startLine, startChar, endLine, endChar) {
    this.start = new Position(startLine, startChar);
    this.end = new Position(endLine || startLine, endChar || startChar);
  }
}

// --- Position ---
class Position {
  constructor(line, character) {
    this.line = line;
    this.character = character;
  }
}

// --- EventEmitter ---
class EventEmitter {
  constructor() {
    this._listeners = new Set();
  }
  // Настоящая подписка: раньше заглушка возвращала пустой disposable и fire()
  // ничего не делал, поэтому события расширения в юнит-тестах были слепыми.
  get event() {
    return (listener) => {
      this._listeners.add(listener);
      return { dispose: () => this._listeners.delete(listener) };
    };
  }
  fire(data) {
    for (const listener of [...this._listeners]) listener(data);
  }
  dispose() {
    this._listeners.clear();
  }
}

/** Эмиттер события изменения настроек: тесты могут его дёргать. */
const configEmitter = new EventEmitter();

/** События документов и файлов: раньше были слепыми заглушками без доставки. */
const didEmitters = {
  onDidChangeTextDocument: new EventEmitter(),
  onDidCreateFiles: new EventEmitter(),
  onDidDeleteFiles: new EventEmitter(),
  onDidSaveTextDocument: new EventEmitter(),
  onDidOpenTextDocument: new EventEmitter(),
  onDidCloseTextDocument: new EventEmitter(),
};

// --- Workspace ---
const workspace = {
  workspaceFolders: [{ uri: Uri.file('/fake/workspace'), name: 'test', index: 0 }],
  registerTextDocumentContentProvider() { return { dispose() {} }; },
  registerCodeLensProvider() { return { dispose() {} }; },
  applyEdit() { return Promise.resolve(true); },
  // Реальная доставка: настройки меняются в тестах, и обработчик расширения должен срабатывать
  onDidChangeConfiguration(listener) { return configEmitter.event(listener); },
  /** Дёрнуть событие изменения настроек из теста (эмулирует правку settings.json). */
  __fireDidChangeConfiguration(event = { affectsConfiguration: () => true }) {
    configEmitter.fire(event);
  },
  getConfiguration(section) {
    return {
      get(key, defaultValue) {
        return defaultValue;
      },
    };
  },
  fs: {
    readFile(uri) { return Promise.resolve(new Uint8Array()); },
    writeFile(uri, data) { return Promise.resolve(); },
    createDirectory(uri) { return Promise.resolve(); },
    stat(uri) { return Promise.resolve({ size: 0, type: 1 }); },
  },
  // Живые события документов/файлов: тест может их дёрнуть через __fireDid
  onDidChangeTextDocument(listener) { return didEmitters.onDidChangeTextDocument.event(listener); },
  onDidCreateFiles(listener) { return didEmitters.onDidCreateFiles.event(listener); },
  onDidDeleteFiles(listener) { return didEmitters.onDidDeleteFiles.event(listener); },
  onDidSaveTextDocument(listener) { return didEmitters.onDidSaveTextDocument.event(listener); },
  onDidOpenTextDocument(listener) { return didEmitters.onDidOpenTextDocument.event(listener); },
  onDidCloseTextDocument(listener) { return didEmitters.onDidCloseTextDocument.event(listener); },
  /** Дёрнуть событие документа/файлов по имени метода-регистратора. */
  __fireDid(name, payload) {
    const emitter = didEmitters[name];
    if (!emitter) throw new Error(`в моке нет события ${name}`);
    emitter.fire(payload);
  },
  findFiles(include, exclude, maxResults) {
    return Promise.resolve([]);
  },
  openTextDocument(path) {
    return Promise.resolve({ getText: () => '', languageId: 'plaintext' });
  },
  textDocuments: [],
};

// --- Window ---
class RelativePattern {
  constructor(base, pattern) { this.base = base; this.pattern = pattern; }
}

const OverviewRulerLane = { Left: 1, Center: 2, Right: 4, Full: 7 };

const languages = {
  registerInlineCompletionItemProvider() { return { dispose() {} }; },
  registerCompletionItemProvider() { return { dispose() {} }; },
  createDiagnosticCollection() { return { set() {}, clear() {}, dispose() {} }; },
};

const ViewColumn = { Active: -1, Beside: -2, One: 1, Two: 2 };

const window = {
  activeTextEditor: undefined,
  /** Живые редакторы (тесты подменяют список) */
  visibleTextEditors: [],
  /** Группы вкладок: нужны для закрытия diff-предпросмотра */
  tabGroups: {
    all: [],
    close(tab) { return Promise.resolve(true); },
  },
  showInformationMessage(msg) { return Promise.resolve(); },
  showErrorMessage(msg) { return Promise.resolve(); },
  showWarningMessage(msg) { return Promise.resolve(); },
  showQuickPick(items, options) { return Promise.resolve(); },
  showInputBox(options) { return Promise.resolve(); },
  showSaveDialog(options) { return Promise.resolve(); },
  createOutputChannel(name) {
    return {
      appendLine(text) {},
      show() {},
      dispose() {},
    };
  },
  /** Типы декораций: реальный API возвращает объект с dispose(), его подменяют в тестах */
  createTextEditorDecorationType(options) {
    return { key: 'decoration', dispose() {} };
  },
  registerWebviewViewProvider() { return { dispose() {} }; },
  withProgress(options, task) {
    const progress = { report: () => {} };
    const token = { isCancellationRequested: false, onCancellationRequested: () => {} };
    return task(progress, token);
  },
};

// --- ExtensionContext (mock) ---
class ExtensionContext {
  constructor() {
    this.subscriptions = [];
    this.workspaceState = new Map();
    this.globalState = new Map();
    this.extensionUri = Uri.file('/fake/extension');
    this.extensionPath = '/fake/extension';
  }
}

// --- Commands ---
const commands = {
  registerCommand(name, handler) {
    return { dispose: () => {} };
  },
  registerTextEditorCommand(name, handler) {
    return { dispose: () => {} };
  },
  executeCommand(name, ...args) {
    return Promise.resolve();
  },
};

module.exports = {
  Uri,
  Range,
  Position,
  workspace,
  window,
  ViewColumn,
  languages,
  OverviewRulerLane,
  RelativePattern,
  ExtensionContext,
  EventEmitter,
  commands,
  // Часто используемые enum'ы
  ConfigurationTarget: { Global: 1, Workspace: 2, WorkspaceFolder: 3 },
  ProgressLocation: { Notification: 15, Window: 15 },
};
