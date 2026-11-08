/**
 * Виртуальные документы для diff-редактора: держит текст «до» и «после» в памяти,
 * не создавая файлов на диске.
 */

import * as vscode from 'vscode';

/** Схема URI виртуальных документов предпросмотра правки */
export const PROPOSAL_SCHEME = 'llma-proposal';

export class ProposalContentProvider implements vscode.TextDocumentContentProvider {
  private readonly store = new Map<string, string>();
  private readonly emitter = new vscode.EventEmitter<vscode.Uri>();

  public readonly onDidChange = this.emitter.event;

  /** Зарегистрировать провайдер в VS Code (один раз на расширение) */
  public register(): vscode.Disposable {
    return vscode.workspace.registerTextDocumentContentProvider(PROPOSAL_SCHEME, this);
  }

  /** Положить текст по URI (обновит открытый документ, если он уже есть) */
  public set(uri: vscode.Uri, text: string): void {
    this.store.set(uri.toString(), text);
    this.emitter.fire(uri);
  }

  /** Удалить текст (после accept/reject) */
  public delete(uri: vscode.Uri): void {
    this.store.delete(uri.toString());
  }

  public provideTextDocumentContent(uri: vscode.Uri): string {
    return this.store.get(uri.toString()) ?? '';
  }
}
