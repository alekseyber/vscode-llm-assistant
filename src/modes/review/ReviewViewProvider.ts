// ReviewViewProvider — WebviewViewProvider для вкладки «Ревью» в Activity Bar.
// Показывает компактную строку-сводку код-ревью; по клику открывает широкое окно
// (ReviewPanel) с полным markdown-отчётом.

import * as vscode from 'vscode';

/** ID вида — регистрируется в package.json */
export const REVIEW_VIEW_TYPE = 'llmAssistant.review';

/**
 * ReviewViewProvider — компактная сводка ревью + точка входа в полное окно.
 */
export class ReviewViewProvider implements vscode.WebviewViewProvider {
  private view?: vscode.WebviewView;
  private currentFile = '';
  private currentReport = '';
  private currentCost = 0;

  /** Колбэк открытия полного отчёта (клик по строке) — задаётся в extension.ts */
  onOpen?: (filePath: string, report: string, cost: number) => void;

  constructor() {}

  resolveWebviewView(
    webviewView: vscode.WebviewView,
    _context: vscode.WebviewViewResolveContext,
    _token: vscode.CancellationToken,
  ): void {
    this.view = webviewView;
    webviewView.webview.options = { enableScripts: true };
    webviewView.webview.html = this.getHtmlContent();
    webviewView.webview.onDidReceiveMessage((msg) => this.handleMessage(msg));
  }

  /** Показать компактную сводку (вызывается после ревью). Полный отчёт — по клику. */
  showReview(filePath: string, report: string, cost: number): void {
    this.currentFile = filePath;
    this.currentReport = report;
    this.currentCost = cost;

    // Постить напрямую, если view уже разрешён; иначе ready-обработчик подхватит.
    this.postMessage({ type: 'reviewSummary', filePath, cost });
    // Reveal вкладку (best-effort — не критично для отображения).
    vscode.commands.executeCommand('llmAssistant.review.focus').then(undefined, () => {});
  }

  private handleMessage(message: any): void {
    switch (message.type) {
      case 'ready':
        if (this.currentReport) {
          this.postMessage({ type: 'reviewSummary', filePath: this.currentFile, cost: this.currentCost });
        }
        break;
      case 'openReview':
        this.onOpen?.(this.currentFile, this.currentReport, this.currentCost);
        break;
    }
  }

  private postMessage(msg: any): void {
    this.view?.webview.postMessage(msg);
  }

  /** HTML компактной сводки: кликабельная строка «🔍 файл — стоимость» */
  private getHtmlContent(): string {
    return `<!DOCTYPE html>
<html lang="ru">
<head>
  <meta charset="UTF-8" />
  <meta http-equiv="Content-Security-Policy"
        content="default-src 'none'; style-src 'unsafe-inline'; script-src 'unsafe-inline';" />
  <title>Ревью</title>
  <style>
    :root {
      --bg: #1e1e1e; --bg-hover: #2a2a2a; --text: #cccccc; --text-dim: #969696;
      --accent: #007acc; --border: #3c3c3c;
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
      font-size: 12px; color: var(--text); background: var(--bg);
    }
    body { margin: 0; padding: 8px; }
    .empty { color: var(--text-dim); font-style: italic; text-align: center; padding: 16px 0; }
    .summary { display: none; }
    .summary-row {
      display: flex; align-items: center; gap: 8px;
      padding: 8px 10px; border: 1px solid var(--border); border-radius: 5px;
      cursor: pointer; background: var(--bg);
    }
    .summary-row:hover { background: var(--bg-hover); }
    .summary-row .icon { font-size: 14px; }
    .summary-text { flex: 1; min-width: 0; }
    .summary-text .file { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
    .summary-text .cost { color: var(--accent); font-size: 11px; margin-top: 1px; }
    .summary-row .hint { color: var(--text-dim); font-size: 13px; }
  </style>
</head>
<body>
  <div class="empty" id="empty-state">Запустите код-ревью (палитра команд → «LLM Assistant: Review File»)</div>
  <div class="summary" id="summary">
    <div class="summary-row" id="summary-row" title="Открыть полный отчёт">
      <span class="icon">🔍</span>
      <div class="summary-text">
        <div class="file" id="file-path"></div>
        <div class="cost" id="cost"></div>
      </div>
      <span class="hint">↗</span>
    </div>
  </div>

  <script>
    (function() {
      const vscode = acquireVsCodeApi();
      const summaryEl = document.getElementById('summary');
      const emptyEl = document.getElementById('empty-state');
      const fileEl = document.getElementById('file-path');
      const costEl = document.getElementById('cost');

      document.getElementById('summary-row').addEventListener('click', function() {
        vscode.postMessage({ type: 'openReview' });
      });

      window.addEventListener('message', function(event) {
        const msg = event.data;
        if (msg.type === 'reviewSummary') {
          summaryEl.style.display = '';
          emptyEl.style.display = 'none';
          fileEl.textContent = msg.filePath || '(без файла)';
          costEl.textContent = msg.cost > 0 ? 'Стоимость: $' + msg.cost.toFixed(6) : '';
        }
      });

      vscode.postMessage({ type: 'ready' });
    })();
  </script>
</body>
</html>`;
  }
}
