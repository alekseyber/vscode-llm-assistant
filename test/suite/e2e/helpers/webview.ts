// Фейковая WebviewView для e2e: журнал исходящих сообщений и инжектор входящих.
// Ровно тот минимум, который дёргает ChatViewProvider.resolveWebviewView.

import * as vscode from 'vscode';

export interface FakeWebviewView {
  /** Идентификатор вида из package.json (`views.llmAssistant[].id`) */
  viewType: string;
  posted: any[];
  webview: {
    options: any;
    html: string;
    cspSource: string;
    asWebviewUri: (uri: vscode.Uri) => vscode.Uri;
    postMessage: (message: any) => Promise<boolean>;
    onDidReceiveMessage: (cb: (message: any) => void) => { dispose: () => void };
  };
  visible: boolean;
  show: () => void;
  dispose: () => void;
  onDidDispose: () => { dispose: () => void };
  onDidChangeVisibility: () => { dispose: () => void };
  /** Отправить сообщение «из панели» в провайдер. */
  send: (message: any) => void;
}

export function createFakeWebviewView(): FakeWebviewView {
  const posted: any[] = [];
  let listener: ((message: any) => void) | undefined;
  const webview = {
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
    dispose: () => undefined,
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
