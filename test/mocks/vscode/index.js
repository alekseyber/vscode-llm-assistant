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
  // Поддерживает обе формы реального API: `new Range(0, 0, 1, 5)` и `new Range(position, position)`
  constructor(startLine, startChar, endLine, endChar) {
    if (startLine instanceof Position) {
      this.start = startLine;
      this.end = startChar instanceof Position ? startChar : startLine;
      return;
    }
    this.start = new Position(startLine, startChar);
    this.end = new Position(endLine ?? startLine, endChar ?? startChar);
  }
}

// --- Position ---
class Position {
  constructor(line, character) {
    this.line = line;
    this.character = character;
  }
}

// --- Inline completion (ghost text) ---
class InlineCompletionItem {
  constructor(insertText, range, command) {
    this.insertText = insertText;
    this.range = range;
    this.command = command;
  }
}

class InlineCompletionList {
  constructor(items = []) {
    this.items = items;
  }
}

/** Провайдеры inline-завершений: тесты получают их через __inlineProviders */
const path = require('path');
const inlineProviders = [];

/** Источник токена отмены: тесты отменяют запрос так же, как это делает VS Code */
class CancellationTokenSource {
  constructor() {
    this._cancelled = false;
    this._listeners = new Set();
  }
  get token() {
    const source = this;
    return {
      get isCancellationRequested() {
        return source._cancelled;
      },
      onCancellationRequested: (listener) => {
        source._listeners.add(listener);
        return { dispose: () => source._listeners.delete(listener) };
      },
    };
  }
  cancel() {
    this._cancelled = true;
    for (const listener of [...this._listeners]) listener();
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
const tabsEmitter = new EventEmitter();

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
/** Хранилище настроек: тесты задают значения через workspace.__settings */
const settings = {};

/** Файлы и каталоги в памяти — настоящая ФС для тестов инструментов агента */
const memoryFs = { files: new Map(), dirs: new Set() };

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
  /**
   * Живая конфигурация: значения читаются из `__settings`, `update` пишет и дёргает событие.
   * Раньше `get` всегда возвращал defaultValue, поэтому тесты не видели настроек вообще.
   */
  getConfiguration(section) {
    const prefix = section ? `${section}.` : '';
    return {
      get(key, defaultValue) {
        const full = `${prefix}${key}`;
        return full in settings ? settings[full] : defaultValue;
      },
      has(key) {
        return `${prefix}${key}` in settings;
      },
      async update(key, value) {
        const full = `${prefix}${key}`;
        if (value === undefined) delete settings[full];
        else settings[full] = value;
        configEmitter.fire({
          affectsConfiguration: (changed) => full === changed || full.startsWith(`${changed}.`),
        });
      },
      inspect(key) {
        return { globalValue: settings[`${prefix}${key}`] };
      },
    };
  },
  /**
   * Файловая система в памяти: readFile/writeFile/stat работают по-настоящему.
   * Раньше readFile всегда отдавал пустой массив, и тесты инструментов агента
   * проверяли не чтение файла, а собственную заглушку.
   */
  fs: {
    async readFile(uri) {
      const data = memoryFs.files.get(uri.fsPath);
      if (!data) throw Object.assign(new Error(`FileNotFound: ${uri.fsPath}`), { code: 'FileNotFound' });
      return data;
    },
    async writeFile(uri, data) {
      memoryFs.files.set(uri.fsPath, data instanceof Uint8Array ? data : new Uint8Array(data));
      memoryFs.dirs.add(path.dirname(uri.fsPath));
    },
    async createDirectory(uri) {
      memoryFs.dirs.add(uri.fsPath);
    },
    async stat(uri) {
      const data = memoryFs.files.get(uri.fsPath);
      if (data) return { size: data.length, type: 1 };
      if (memoryFs.dirs.has(uri.fsPath)) return { size: 0, type: 2 };
      throw Object.assign(new Error(`FileNotFound: ${uri.fsPath}`), { code: 'FileNotFound' });
    },
    async delete(uri) {
      memoryFs.files.delete(uri.fsPath);
    },
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
  /** Настройки, которые видит расширение (сбрасываются тестами) */
  __settings: settings,
  /** Файловая система в памяти: тесты кладут файлы и читают результат */
  __fs: memoryFs,
};

// --- Window ---
class RelativePattern {
  constructor(base, pattern) { this.base = base; this.pattern = pattern; }
}

const OverviewRulerLane = { Left: 1, Center: 2, Right: 4, Full: 7 };

const languages = {
  // Живая регистрация: провайдер сохраняется, и тест может вызвать его напрямую
  registerInlineCompletionItemProvider(selector, provider) {
    inlineProviders.push(provider);
    return {
      dispose: () => {
        const index = inlineProviders.indexOf(provider);
        if (index >= 0) inlineProviders.splice(index, 1);
      },
    };
  },
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
    // Живое событие: правка/закрытие вкладки в тестах должна доходить до слушателя
    onDidChangeTabs(listener) { return tabsEmitter.event(listener); },
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
  InlineCompletionItem,
  InlineCompletionList,
  CancellationTokenSource,
  /** Провайдеры inline-завершений, зарегистрированные расширением */
  __inlineProviders: inlineProviders,
  ExtensionContext,
  EventEmitter,
  commands,
  // Часто используемые enum'ы
  ConfigurationTarget: { Global: 1, Workspace: 2, WorkspaceFolder: 3 },
  ProgressLocation: { Notification: 15, Window: 15 },
};
