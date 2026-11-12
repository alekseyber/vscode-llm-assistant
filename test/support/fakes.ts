// Двойники доменных типов для тестов: провайдер, документ, редактор, webview-вью.
//
// Зачем: тесты собирали объекты вручную и приводили их к `any`, чтобы пройти проверку типов
// (`{ name: 'stub', chat: ... } as any`). Фейк возвращает настоящий тип — если у интерфейса
// добавят обязательное поле, тест перестанет компилироваться, а не сломается в рантайме.

import * as vscode from 'vscode';
import { ChatMessage, CompletionOptions, LLMProvider } from '../../src/providers/types';
import { MultiAgentResult, WorkerTaskResult } from '../../src/modes/apply/AgentOrchestrator';
import { WorkerResult } from '../../src/modes/apply/AgentWorker';

export interface ProviderFakeOptions {
  name?: string;
  models?: string[];
  isLocal?: boolean;
  /** Что вернёт стрим: одна строка или функция от сообщений */
  response?: string | ((messages: readonly ChatMessage[]) => string);
  /** Размер куска в потоке (по умолчанию 16 символов). Тест может задать 0 — ответ одним куском */
  chunkSize?: number;
}

export interface ProviderFake extends LLMProvider {
  // Внимание: объекты VS Code собираются через `as unknown as` — полный набор полей интерфейса
  // не создаётся. Это осознанное исключение для внешних типов; счётчик приведений его видит
  // отдельной строкой (`check:test-any` → «as unknown as»).
  /** Сообщения всех запросов — для проверки того, что ушло модели */
  calls: Array<{ messages: readonly ChatMessage[]; options: CompletionOptions }>;
}

/** Провайдер-двойник: отвечает заранее заданным текстом потоком, как настоящий. */
export function fakeProvider(options: ProviderFakeOptions = {}): ProviderFake {
  const calls: ProviderFake['calls'] = [];
  const provider: ProviderFake = {
    name: options.name ?? 'fake',
    isLocal: options.isLocal ?? false,
    calls,
    models: async () => options.models ?? ['fake-model'],
    chat: (messages, chatOptions) => {
      calls.push({ messages, options: chatOptions });
      const text =
        typeof options.response === 'function' ? options.response(messages) : options.response ?? 'ответ';
      const size = options.chunkSize ?? 16;
      return (async function* () {
        if (size <= 0) {
          yield text;
          return;
        }
        for (let i = 0; i < text.length; i += size) yield text.slice(i, i + size);
      })();
    },
  } as ProviderFake;
  return provider;
}

/** Документ с настоящим `getText(range)`: по нему собирается контекст. */
export function fakeDocument(
  text: string,
  options: { scheme?: string; uri?: string; languageId?: string } = {},
): vscode.TextDocument {
  const lines = text.split('\n');
  const offsets: number[] = [];
  let offset = 0;
  for (const line of lines) {
    offsets.push(offset);
    offset += line.length + 1;
  }
  const toOffset = (line: number, character: number) =>
    (offsets[Math.min(line, lines.length - 1)] ?? 0) + character;
  return {
    uri: {
      scheme: options.scheme ?? 'file',
      fsPath: '/fake/workspace/src/example.ts',
      toString: () => options.uri ?? 'file:///fake/workspace/src/example.ts',
    },
    languageId: options.languageId ?? 'typescript',
    lineCount: lines.length,
    lineAt: (line: number) => ({ text: lines[line] ?? '' }),
    getText: (range?: vscode.Range) =>
      range
        ? text.slice(toOffset(range.start.line, range.start.character), toOffset(range.end.line, range.end.character))
        : text,
  } as unknown as vscode.TextDocument;
}

/** Редактор с документом и выделением — для команд, которым нужен активный редактор. */
export function fakeTextEditor(text: string, selectionText = ''): vscode.TextEditor {
  const document = fakeDocument(text);
  return {
    document,
    selection: { isEmpty: selectionText.length === 0 },
    selections: [],
  } as unknown as vscode.TextEditor;
}

/** Снимок того, что расширение показало в webview. */
export interface WebviewViewFake {
  view: vscode.WebviewView;
  messages: any[];
  send(message: unknown): void;
}

export function fakeWebviewView(): WebviewViewFake {
  const messages: any[] = [];
  const view = {
    webview: {
      html: '',
      options: {},
      onDidReceiveMessage: () => ({ dispose() {} }),
      postMessage: async (message: unknown) => {
        messages.push(message);
        return true;
      },
      asWebviewUri: (uri: unknown) => uri,
      cspSource: 'vscode-resource:',
    },
    onDidChangeVisibility: () => ({ dispose() {} }),
    onDidDispose: () => ({ dispose() {} }),
    visible: true,
    show: () => undefined,
  } as unknown as vscode.WebviewView;
  return {
    view,
    messages,
    send(message: unknown) {
      const listeners = (view.webview as unknown as { __listeners?: Array<(m: unknown) => void> }).__listeners;
      for (const listener of listeners ?? []) listener(message);
    },
  };
}

/** Конфигурация с заданным `get`; остальные методы пустые — тесту нужен только ответ настроек. */
export function fakeConfiguration(
  get: (key: string, defaultValue?: unknown) => unknown,
): vscode.WorkspaceConfiguration {
  return {
    get<T>(key: string, defaultValue?: T): T | undefined {
      return get(key, defaultValue) as T | undefined;
    },
    has: () => false,
    inspect: () => undefined,
    update: async () => undefined,
  };
}

export interface MementoFakeOptions {
  /**
   * Хранить записанное. `false` — «пустое» хранилище: `get` всегда отдаёт `defaultValue`,
   * как у расширения, которое ещё ничего не сохраняло.
   */
  persist?: boolean;
}

/** `vscode.Memento` в памяти — рабочее или пустое хранилище. */
export function fakeMemento(options: MementoFakeOptions = {}): vscode.Memento {
  const persist = options.persist ?? true;
  const store = new Map<string, unknown>();
  return {
    get<T>(key: string, defaultValue?: T): T | undefined {
      if (persist && store.has(key)) return store.get(key) as T;
      return defaultValue;
    },
    update<T>(key: string, value: T): Thenable<void> {
      if (persist) store.set(key, value);
      return Promise.resolve();
    },
    keys(): readonly string[] {
      return persist ? [...store.keys()] : [];
    },
  };
}

/**
 * Канал вывода, который ничего не печатает.
 * Возвращаем `LogOutputChannel` — его отдаёт перегрузка `createOutputChannel`, которую
 * выбирает компилятор, и он же подходит везде, где ждут обычный `OutputChannel`.
 */
export function fakeOutputChannel(name = 'test'): vscode.LogOutputChannel {
  return {
    name,
    append: () => undefined,
    appendLine: () => undefined,
    replace: () => undefined,
    clear: () => undefined,
    show: () => undefined,
    hide: () => undefined,
    dispose: () => undefined,
    logLevel: vscode.LogLevel.Info,
    onDidChangeLogLevel: () => ({ dispose: () => undefined }),
    trace: () => undefined,
    debug: () => undefined,
    info: () => undefined,
    warn: () => undefined,
    error: () => undefined,
  };
}

/** Рабочая папка `workspaceFolders` с реальным `uri.fsPath`. */
export function fakeWorkspaceFolder(fsPath: string): vscode.WorkspaceFolder {
  return {
    uri: vscode.Uri.file(fsPath),
    name: fsPath.split(/[\\/]/).filter(Boolean).pop() ?? fsPath,
    index: 0,
  };
}

/** Контекст, у которого `extensionUri` можно подменить: тесты html читают ресурсы из корня репо. */
export interface MutableExtensionContext extends vscode.ExtensionContext {
  extensionUri: vscode.Uri;
}

/**
 * Контекст расширения с подставленными хранилищами.
 *
 * `as unknown as` здесь — то же исключение, что и у `fakeDocument`/`fakeWebviewView`: полный
 * набор полей `ExtensionContext` (secrets, environmentVariableCollection, storageUri, …)
 * тестам не нужен, а расширение читает только subscriptions/globalState/workspaceState/extensionUri.
 */
export function fakeExtensionContext(
  options: {
    extensionUri?: vscode.Uri;
    workspaceState?: vscode.Memento;
    globalState?: vscode.Memento;
  } = {},
): MutableExtensionContext {
  const extensionUri = options.extensionUri ?? vscode.Uri.file('/tmp');
  return {
    subscriptions: [],
    extensionUri,
    extensionPath: extensionUri.fsPath,
    workspaceState: options.workspaceState ?? fakeMemento({ persist: false }),
    globalState: options.globalState ?? fakeMemento(),
    asAbsolutePath: (relativePath: string) => `${extensionUri.fsPath}/${relativePath}`,
  } as unknown as MutableExtensionContext;
}

export interface WorkerFakeOptions {
  roleName: string;
  /** Поля результата воркера, которые важны тесту; остальные — осмысленные умолчания */
  result?: Partial<WorkerResult>;
}

/**
 * Сводный результат оркестрации: тесту интересны один-два воркера и итог, а не весь отчёт.
 * Суммы считаются по воркерам — как у настоящего оркестратора.
 */
export function fakeMultiAgentResult(
  options: { workers?: WorkerFakeOptions[]; success?: boolean; summary?: string } = {},
): MultiAgentResult {
  const workers: WorkerTaskResult[] = (options.workers ?? []).map((worker) => ({
    roleName: worker.roleName,
    result: {
      answer: '',
      steps: [],
      iterations: 1,
      inputTokens: 0,
      outputTokens: 0,
      cost: 0,
      ...worker.result,
    },
  }));
  return {
    taskId: 'orch_test',
    strategy: 'sequential',
    workers,
    totalInputTokens: workers.reduce((sum, w) => sum + w.result.inputTokens, 0),
    totalOutputTokens: workers.reduce((sum, w) => sum + w.result.outputTokens, 0),
    totalCost: workers.reduce((sum, w) => sum + w.result.cost, 0),
    costPerWorker: Object.fromEntries(workers.map((w) => [w.roleName, w.result.cost])),
    success: options.success ?? true,
    summary: options.summary ?? workers.map((w) => w.result.answer).join('\n'),
  };
}
