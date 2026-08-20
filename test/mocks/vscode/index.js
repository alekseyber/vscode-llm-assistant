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
    this._listeners = {};
  }
  event(listener) {
    return { dispose: () => {} };
  }
  fire(data) {}
}

// --- Workspace ---
const workspace = {
  workspaceFolders: [{ uri: Uri.file('/fake/workspace'), name: 'test', index: 0 }],
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
  },
  onDidChangeConfiguration(listener) {
    return { dispose: () => {} };
  },
  onDidChangeTextDocument(listener) {
    return { dispose: () => {} };
  },
  onDidCreateFiles(listener) {
    return { dispose: () => {} };
  },
  onDidDeleteFiles(listener) {
    return { dispose: () => {} };
  },
  onDidSaveTextDocument(listener) {
    return { dispose: () => {} };
  },
  onDidOpenTextDocument(listener) {
    return { dispose: () => {} };
  },
  onDidCloseTextDocument(listener) {
    return { dispose: () => {} };
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
const window = {
  showInformationMessage(msg) { return Promise.resolve(); },
  showErrorMessage(msg) { return Promise.resolve(); },
  showWarningMessage(msg) { return Promise.resolve(); },
  showQuickPick(items, options) { return Promise.resolve(); },
  showInputBox(options) { return Promise.resolve(); },
  createOutputChannel(name) {
    return {
      appendLine(text) {},
      show() {},
      dispose() {},
    };
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
  ExtensionContext,
  EventEmitter,
  commands,
  // Часто используемые enum'ы
  ConfigurationTarget: { Global: 1, Workspace: 2, WorkspaceFolder: 3 },
};
