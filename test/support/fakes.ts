// Двойники доменных типов для тестов: провайдер, документ, редактор, webview-вью.
//
// Зачем: тесты собирали объекты вручную и приводили их к `any`, чтобы пройти проверку типов
// (`{ name: 'stub', chat: ... } as any`). Фейк возвращает настоящий тип — если у интерфейса
// добавят обязательное поле, тест перестанет компилироваться, а не сломается в рантайме.

import * as vscode from 'vscode';
import { ChatMessage, CompletionOptions, LLMProvider } from '../../src/providers/types';

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

/**
 * Контекст расширения для панелей и команд: тесты используют только `subscriptions`
 * (панель кладёт туда подписки) и `extensionUri` (от него считается путь к marked.min.js).
 * Остальные поля VS Code-интерфейса расширение не читает, поэтому не создаются —
 * тот же осознанный `as unknown as`, что и у остальных внешних типов (см. выше).
 */
export function fakeExtensionContext(extensionUri = 'file:///fake/extension'): vscode.ExtensionContext {
  const context = {
    subscriptions: [] as vscode.Disposable[],
    extensionUri: vscode.Uri.parse(extensionUri),
  };
  return context as unknown as vscode.ExtensionContext;
}

/** Заглушка контекста resolveWebviewView: провайдеры его не читают. */
export const FAKE_RESOLVE_CONTEXT: vscode.WebviewViewResolveContext = { state: undefined };

/** Заглушка CancellationToken: отмена в этих тестах не запрашивается. */
export const FAKE_CANCELLATION_TOKEN: vscode.CancellationToken = {
  isCancellationRequested: false,
  onCancellationRequested: () => ({ dispose() {} }),
};

/** Снимок того, что расширение показало в webview, + канал «WebView → расширение». */
export interface WebviewViewFake {
  view: vscode.WebviewView;
  messages: any[];
  /** Доставить сообщение из WebView в расширение — как это делает VS Code */
  send(message: unknown): void;
}

export function fakeWebviewView(): WebviewViewFake {
  const messages: any[] = [];
  const listeners: Array<(message: any) => void> = [];
  const view = {
    webview: {
      html: '',
      options: {},
      onDidReceiveMessage: (listener: (message: any) => void) => {
        listeners.push(listener);
        return { dispose() {} };
      },
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
      for (const listener of listeners) listener(message);
    },
  };
}
