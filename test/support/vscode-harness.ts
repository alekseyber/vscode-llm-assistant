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
};

const languages = vscode.languages as unknown as {
  __inlineProviders: vscode.InlineCompletionItemProvider[];
};

const windowMock = vscode.window as unknown as {
  __inputBoxValue: string | undefined;
  activeTextEditor: vscode.TextEditor | undefined;
  showWarningMessage: (message: string) => Promise<unknown>;
  showInformationMessage: (message: string) => Promise<unknown>;
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

/**
 * Конфигурация, которую «видит» расширение: `read` отвечает за значение, остальное —
 * то, что передал вызывающий код вторым аргументом `get`.
 *
 * Зачем: `vscode.WorkspaceConfiguration` — широкий интерфейс, и тесту нужен только `get`.
 * Собирать его целиком бессмысленно, поэтому неполный объект приводится здесь один раз,
 * а не `as any` в каждом тесте.
 */
export function fakeConfiguration(
  read: (key: string, defaultValue?: unknown) => unknown,
): vscode.WorkspaceConfiguration {
  return {
    get: read,
    has: () => false,
    inspect: () => undefined,
    update: async () => undefined,
  } as unknown as vscode.WorkspaceConfiguration;
}

/** Сбросить настройки между тестами. */
export function resetSettings(): void {
  for (const key of Object.keys(workspace.__settings)) delete workspace.__settings[key];
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

/** Подменить ответ диалогов и запомнить показанные сообщения. */
export function stubDialogs(options: {
  warning?: (message: string) => Promise<unknown> | unknown;
  information?: (message: string) => Promise<unknown> | unknown;
  inputBox?: (options?: unknown) => Promise<string | undefined>;
} = {}): { warnings: string[]; infos: string[]; restore(): void } {
  const original = {
    warning: windowMock.showWarningMessage,
    information: windowMock.showInformationMessage,
    input: windowMock.showInputBox,
  };
  const warnings: string[] = [];
  const infos: string[] = [];

  if (options.warning) {
    windowMock.showWarningMessage = async (message: string) => {
      warnings.push(message);
      return options.warning!(message);
    };
  }
  if (options.information) {
    windowMock.showInformationMessage = async (message: string) => {
      infos.push(message);
      return options.information!(message);
    };
  }
  if (options.inputBox) {
    windowMock.showInputBox = options.inputBox;
  }

  return {
    warnings,
    infos,
    restore() {
      windowMock.showWarningMessage = original.warning;
      windowMock.showInformationMessage = original.information;
      windowMock.showInputBox = original.input;
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
