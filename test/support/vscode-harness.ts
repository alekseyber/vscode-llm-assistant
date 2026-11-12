// Типизированный доступ к возможностям мок-`vscode` в тестах.
//
// Зачем: в тестах было 130 обращений вида `(vscode.window as any).activeTextEditor = …` и
// `sandbox.stub(...).resolves(...)`. Первое — единственное место, где нужен `any`:
// мок шире публичного API (у него есть `__settings`, `__fireDid…`). Второе — просто лишнее
// приведение, стаб уже типизирован.
//
// Правило: в тестах не пишем `as any`. Нужна возможность мока — берём функцию отсюда.
// Новую возможность сначала добавляем здесь, и только потом используем.

import * as vscode from 'vscode';
import type * as sinon from 'sinon';

/**
 * Внутренние рычаги мока. Наружу отдаём снимки и явные операции, а не ссылки на структуры:
 * иначе тест может незаметно поменять состояние мока в обход типизированных функций.
 * `raw` — осознанная лазейка для редких случаев, помечена в коде и в правилах проекта.
 */
interface MockInternals {
  /** Настройки, которые видит расширение: `llmAssistant.<ключ>` */
  settings: Record<string, unknown>;
  /** Файловая система в памяти */
  fs: { files: Map<string, Uint8Array>; dirs: Set<string> };
  /** Панели WebView, созданные расширением */
  webviewPanels: WebviewPanelMock[];
  /** Провайдеры inline-завершений */
  inlineProviders: vscode.InlineCompletionItemProvider[];
  /** Файлы, которые вернёт `findFiles` */
  findFilesResult: string[];
  /** Ответ, который вернёт `showInputBox` */
  inputBoxValue: string | undefined;
  /** Дёрнуть событие настройки */
  fireConfigChange(section?: string): void;
  /** Дёрнуть событие документа/файлов по имени регистратора */
  fireDid(name: string, payload?: unknown): void;
}

export interface WebviewPanelMock {
  webview: { html: string; postMessage(message: unknown): Promise<boolean> };
  messages: any[];
  revealed: number;
  disposed: boolean;
  dispose(): void;
  __sendMessage(message: unknown): void;
}

const workspace = vscode.workspace as unknown as {
  __settings: Record<string, unknown>;
  __fs: { files: Map<string, Uint8Array>; dirs: Set<string> };
  __webviewPanels: WebviewPanelMock[];
  __findFilesResult: string[];
  __fireDidChangeConfiguration(event: { affectsConfiguration(section: string): boolean }): void;
  __fireDid(name: string, payload?: unknown): void;
  /** Корень workspace в моке: один каталог, `fsPath` разрешено менять тестам */
  workspaceFolders: Array<{ uri: { fsPath: string } }> | undefined;
};

/**
 * Провайдеры inline-завершений: мок кладёт их на корень модуля `vscode`, а не в `languages`
 * (там только реальные методы API).
 */
const languages = vscode as unknown as {
  __inlineProviders: vscode.InlineCompletionItemProvider[];
};

const windowMock = vscode.window as unknown as {
  __inputBoxValue: string | undefined;
  activeTextEditor: vscode.TextEditor | undefined;
  showWarningMessage: (message: string) => Promise<unknown>;
  showInformationMessage: (message: string) => Promise<unknown>;
  showErrorMessage: (message: string) => Promise<unknown>;
  showInputBox: (options?: unknown) => Promise<string | undefined>;
  showQuickPick: (items: unknown, options?: unknown) => Promise<unknown>;
};

export function mockInternals(): MockInternals {
  return {
    get settings() {
      return { ...workspace.__settings };
    },
    set settings(value: Record<string, unknown>) {
      for (const key of Object.keys(workspace.__settings)) delete workspace.__settings[key];
      Object.assign(workspace.__settings, value);
    },
    get fs() {
      return workspace.__fs;
    },
    get webviewPanels() {
      return workspace.__webviewPanels;
    },
    get inlineProviders() {
      return languages.__inlineProviders;
    },
    get findFilesResult() {
      return workspace.__findFilesResult;
    },
    set findFilesResult(value: string[]) {
      workspace.__findFilesResult = value;
    },
    get inputBoxValue() {
      return windowMock.__inputBoxValue;
    },
    set inputBoxValue(value: string | undefined) {
      windowMock.__inputBoxValue = value;
    },
    fireConfigChange(section = 'llmAssistant.autocomplete') {
      workspace.__fireDidChangeConfiguration({
        affectsConfiguration: (changed: string) => section === changed || section.startsWith(`${changed}.`),
      });
    },
    fireDid(name: string, payload?: unknown) {
      workspace.__fireDid(name, payload);
    },
  };
}

/** Сбросить настройки между тестами. */
export function resetSettings(): void {
  for (const key of Object.keys(workspace.__settings)) delete workspace.__settings[key];
}

/**
 * Конфигурация-двойник для `getConfiguration`: `get` считает значение сама функция,
 * остальные методы — заглушки. Стаб отдаёт этот объект на запрос любой секции,
 * поэтому ключи внутри функции — без префикса (`agentsMd.enabled`, `chat.maxTokens`).
 *
 * Зачем: тесты собирали такой объект вручную и ставили `as any`, хотя структура
 * укладывается в `vscode.WorkspaceConfiguration` без приведения.
 */
export function fakeConfiguration(
  get: (key: string, defaultValue?: unknown) => unknown,
): vscode.WorkspaceConfiguration {
  return {
    get: (key: string, defaultValue?: unknown) => get(key, defaultValue),
    has: () => false,
    inspect: () => undefined,
    update: async () => undefined,
  };
}

/**
 * Memento-двойник с sinon-стабами: тест задаёт ответы через `withArgs`.
 * `setKeysForSync` в интерфейсе `vscode.Memento` этой версии нет — не добавляем.
 */
export function fakeMementoStubs(sandbox: sinon.SinonSandbox): sinon.SinonStubbedInstance<vscode.Memento> {
  const memento = {
    get: sandbox.stub(),
    update: sandbox.stub().resolves(),
    keys: sandbox.stub().returns([]),
  };
  return memento as unknown as sinon.SinonStubbedInstance<vscode.Memento>;
}

/**
 * Канал вывода, который расширение создаёт при активации. Все методы — заглушки:
 * тестам нужен факт создания канала, а не его содержимое.
 */
export function fakeOutputChannel(name = 'llmAssistant'): vscode.LogOutputChannel {
  const noop = () => undefined;
  return {
    name,
    // LogLevel.Info: enum в моке не объявлен, значение берём из реального API
    logLevel: 3 as vscode.LogLevel,
    onDidChangeLogLevel: () => ({ dispose: noop }),
    trace: noop,
    debug: noop,
    info: noop,
    warn: noop,
    error: noop,
    append: noop,
    appendLine: noop,
    replace: noop,
    clear: noop,
    show: noop,
    hide: noop,
    dispose: noop,
  };
}

/** Токен отмены для вызовов, которым он нужен по сигнатуре, а отмена — нет. */
export function fakeCancellationToken(): vscode.CancellationToken {
  return {
    isCancellationRequested: false,
    onCancellationRequested: () => ({ dispose: () => undefined }),
  };
}

/**
 * Корень workspace, который видит расширение: в моке один каталог.
 * Поле `uri.fsPath` в интерфейсе только для чтения, поэтому меняем через тот же
 * слепок мока, что и остальные внутренние рычаги.
 */
export function setWorkspaceRoot(path: string): void {
  const folders = workspace.workspaceFolders;
  if (!folders || folders.length === 0) throw new Error('в моке нет workspaceFolders');
  folders[0].uri.fsPath = path;
}

/** Задать настройку так, как её видит расширение. */
export function setSetting(key: string, value: unknown): void {
  const full = key.startsWith('llmAssistant.') ? key : `llmAssistant.${key}`;
  workspace.__settings[full] = value;
}

/** Активный редактор: мок отдаёт `undefined`, если не задан. */
export function setActiveEditor(editor: vscode.TextEditor | undefined): void {
  windowMock.activeTextEditor = editor;
}

/** Подменённые диалоги: что показали и сколько раз дёргали. */
export interface DialogStubs {
  /** Тексты показанных предупреждений */
  warnings: string[];
  /** Тексты показанных информационных сообщений */
  infos: string[];
  /** Тексты показанных ошибок */
  errors: string[];
  /** Счётчики вызовов — для проверки «UI не дёргали» */
  calls: { warning: number; information: number; error: number; inputBox: number; quickPick: number };
  restore(): void;
}

/** Подменить ответ диалогов и запомнить показанные сообщения. */
export function stubDialogs(options: {
  warning?: (message: string) => Promise<unknown> | unknown;
  information?: (message: string) => Promise<unknown> | unknown;
  error?: (message: string) => Promise<unknown> | unknown;
  inputBox?: (options?: unknown) => Promise<string | undefined> | string | undefined;
  quickPick?: (items: unknown, options?: unknown) => Promise<unknown> | unknown;
} = {}): DialogStubs {
  const original = {
    warning: windowMock.showWarningMessage,
    information: windowMock.showInformationMessage,
    error: windowMock.showErrorMessage,
    input: windowMock.showInputBox,
    quickPick: windowMock.showQuickPick,
  };
  const warnings: string[] = [];
  const infos: string[] = [];
  const errors: string[] = [];
  const calls = { warning: 0, information: 0, error: 0, inputBox: 0, quickPick: 0 };

  if (options.warning) {
    windowMock.showWarningMessage = async (message: string) => {
      calls.warning += 1;
      warnings.push(message);
      return options.warning!(message);
    };
  }
  if (options.information) {
    windowMock.showInformationMessage = async (message: string) => {
      calls.information += 1;
      infos.push(message);
      return options.information!(message);
    };
  }
  if (options.error) {
    windowMock.showErrorMessage = async (message: string) => {
      calls.error += 1;
      errors.push(message);
      return options.error!(message);
    };
  }
  if (options.inputBox) {
    windowMock.showInputBox = async (inputOptions?: unknown) => {
      calls.inputBox += 1;
      return options.inputBox!(inputOptions);
    };
  }
  if (options.quickPick) {
    windowMock.showQuickPick = async (items: unknown, quickPickOptions?: unknown) => {
      calls.quickPick += 1;
      return options.quickPick!(items, quickPickOptions);
    };
  }

  return {
    warnings,
    infos,
    errors,
    calls,
    restore() {
      windowMock.showWarningMessage = original.warning;
      windowMock.showInformationMessage = original.information;
      windowMock.showErrorMessage = original.error;
      windowMock.showInputBox = original.input;
      windowMock.showQuickPick = original.quickPick;
    },
  };
}

/**
 * Лазейка: прямые структуры мока. Использовать только когда нужен сам объект, а не снимок,
 * и обязательно с комментарием, зачем. В новом коде — не нужно.
 */
export function rawMockInternals() {
  return { settings: workspace.__settings, fs: workspace.__fs, panels: workspace.__webviewPanels, providers: languages.__inlineProviders };
}

/** Панель WebView, созданная последней. */
export function lastWebviewPanel(): WebviewPanelMock | undefined {
  const panels = workspace.__webviewPanels;
  return panels[panels.length - 1];
}

/** Провайдер inline-завершений, зарегистрированный последним. */
export function lastInlineProvider(): vscode.InlineCompletionItemProvider {
  const providers = languages.__inlineProviders;
  if (providers.length === 0) throw new Error('провайдер inline-завершений не зарегистрирован');
  return providers[providers.length - 1];
}
