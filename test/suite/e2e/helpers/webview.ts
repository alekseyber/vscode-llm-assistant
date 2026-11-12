// Фейковая WebviewView для e2e: журнал исходящих сообщений и инжектор входящих.
// Ровно тот минимум, который дёргает ChatViewProvider.resolveWebviewView.
//
// Вид структурно совпадает с `vscode.WebviewView`, поэтому провайдеру его можно отдать
// без приведения: если в интерфейсе появится обязательное поле, сборка тестов упадёт.

import * as vscode from 'vscode';

export interface FakeWebviewView extends vscode.WebviewView {
  /** Идентификатор вида из package.json (`views.llmAssistant[].id`) */
  viewType: string;
  posted: any[];
  /** Отправить сообщение «из панели» в провайдер. */
  send(message: any): void;
}

export function createFakeWebviewView(): FakeWebviewView {
  const posted: any[] = [];
  let listener: ((message: any) => void) | undefined;
  const webview: vscode.Webview = {
    options: {},
    html: '',
    cspSource: 'vscode-resource:',
    asWebviewUri: (uri: vscode.Uri) => uri,
    postMessage: async (message: any) => {
      posted.push(message);
      return true;
    },
    onDidReceiveMessage: (cb: (message: any) => void) => {
      listener = cb;
      return { dispose: () => undefined };
    },
  };
  return {
    viewType: 'llmAssistant.chat',
    posted,
    webview,
    visible: true,
    show: () => undefined,
    onDidDispose: () => ({ dispose: () => undefined }),
    onDidChangeVisibility: () => ({ dispose: () => undefined }),
    send: (message: any) => listener?.(message),
  };
}

/** Сообщения указанного типа из журнала панели. */
export function messagesOfType(view: FakeWebviewView, type: string): any[] {
  return view.posted.filter((m) => m?.type === type);
}

/** Склеенный текст из всех streamChunk-сообщений до первого done. */
export function streamedText(view: FakeWebviewView): string {
  let text = '';
  for (const message of view.posted) {
    if (message?.type === 'done') break;
    if (message?.type === 'streamChunk') text += String(message.text ?? '');
  }
  return text;
}
