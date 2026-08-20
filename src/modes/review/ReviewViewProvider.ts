// ReviewViewProvider — WebviewViewProvider для вкладки «Ревью» в Activity Bar.
// Показывает markdown-отчёт код-ревью (рендер через marked.min.js, тот же что в чате).

import * as vscode from 'vscode';
import * as fs from 'fs';

/** ID вида — регистрируется в package.json */
export const REVIEW_VIEW_TYPE = 'llmAssistant.review';

/**
 * ReviewViewProvider — отдельная панель для отчётов код-ревью.
 */
export class ReviewViewProvider implements vscode.WebviewViewProvider {
  private view?: vscode.WebviewView;
  private currentReport = '';
  private currentFile = '';
  private currentCost = 0;

  constructor(private readonly extensionUri: vscode.Uri) {}

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

  /** Показать отчёт код-ревью (вызывается из команды «Review File») */
  showReview(filePath: string, report: string, cost: number): void {
    this.currentFile = filePath;
    this.currentReport = report;
    this.currentCost = cost;

    // Reveal-панель
    vscode.commands.executeCommand('llmAssistant.review.focus').then(
      () => this.postMessage({ type: 'showReview', filePath, report, cost }),
      () => this.postMessage({ type: 'showReview', filePath, report, cost }),
    );
  }

  private handleMessage(message: any): void {
    if (message.type === 'ready' && this.currentReport) {
      this.postMessage({
        type: 'showReview',
        filePath: this.currentFile,
        report: this.currentReport,
        cost: this.currentCost,
      });
    }
  }

  private postMessage(msg: any): void {
    this.view?.webview.postMessage(msg);
  }

  /** HTML панели ревью: заголовок + markdown-отчёт */
  private getHtmlContent(): string {
    // Читаем marked.min.js (общий с чатом) для markdown-рендера
    let markedLib = '';
    try {
      markedLib = fs.readFileSync(
        vscode.Uri.joinPath(this.extensionUri, 'src', 'webviews', 'chat', 'marked.min.js').fsPath,
        'utf-8',
      );
    } catch {
      markedLib = 'window.marked={parse:function(t){return "<pre>"+t+"</pre>";}};';
    }

    return `<!DOCTYPE html>
<html lang="ru">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <meta http-equiv="Content-Security-Policy"
        content="default-src 'none'; style-src 'unsafe-inline'; script-src 'unsafe-inline';" />
  <title>Ревью</title>
  <style>
    :root {
      --bg-primary: #1e1e1e;
      --bg-secondary: #252526;
      --text-primary: #cccccc;
      --text-secondary: #969696;
      --accent: #007acc;
      --border: #3c3c3c;
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
      font-size: 13px;
      color: var(--text-primary);
      background: var(--bg-primary);
    }
    body { padding: 0; margin: 0; display: flex; flex-direction: column; height: 100vh; overflow: hidden; }
    .header {
      padding: 10px 14px;
      background: var(--bg-secondary);
      border-bottom: 1px solid var(--border);
      flex-shrink: 0;
    }
    .header .title { font-weight: 600; font-size: 13px; }
    .header .file { color: var(--text-secondary); font-size: 11px; margin-top: 2px; word-break: break-all; }
    .header .cost { color: var(--accent); font-size: 11px; margin-top: 2px; }
    .report {
      flex: 1;
      overflow-y: auto;
      padding: 12px 16px;
      line-height: 1.6;
    }
    .report h1, .report h2, .report h3 { margin: 12px 0 6px; }
    .report code { background: #2d2d2d; padding: 1px 4px; border-radius: 3px; font-size: 12px; }
    .report pre { background: #2d2d2d; padding: 10px; border-radius: 4px; overflow-x: auto; }
    .report pre code { background: none; padding: 0; }
    .report ul, .report ol { padding-left: 22px; }
    .report li { margin: 3px 0; }
    .report blockquote { border-left: 3px solid var(--border); margin: 8px 0; padding-left: 12px; color: var(--text-secondary); }
    .empty {
      display: flex; align-items: center; justify-content: center; height: 100%;
      color: var(--text-secondary); font-style: italic; font-size: 13px;
    }
    ::-webkit-scrollbar { width: 6px; }
    ::-webkit-scrollbar-track { background: var(--bg-primary); }
    ::-webkit-scrollbar-thumb { background: var(--border); border-radius: 3px; }
  </style>
</head>
<body>
  <div class="header" id="header" style="display:none">
    <div class="title">🔍 Код-ревью</div>
    <div class="file" id="file-path"></div>
    <div class="cost" id="cost"></div>
  </div>
  <div class="report" id="report-container">
    <div class="empty" id="empty-state">Запустите код-ревью (палитра команд → «LLM Assistant: Review File»)</div>
    <div id="report"></div>
  </div>

  <script>
${markedLib}
  </script>
  <script>
    (function() {
      const vscode = acquireVsCodeApi();
      const header = document.getElementById('header');
      const filePath = document.getElementById('file-path');
      const cost = document.getElementById('cost');
      const reportEl = document.getElementById('report');
      const emptyState = document.getElementById('empty-state');

      function renderReport(file, text, costVal) {
        header.style.display = '';
        filePath.textContent = file || '(без файла)';
        cost.textContent = costVal > 0 ? 'Стоимость: $' + costVal.toFixed(6) : '';
        emptyState.style.display = 'none';
        reportEl.innerHTML = window.marked.parse(text, { breaks: true, gfm: false });
      }

      window.addEventListener('message', function(event) {
        const msg = event.data;
        if (msg.type === 'showReview') {
          renderReport(msg.filePath, msg.report, msg.cost || 0);
        }
      });

      vscode.postMessage({ type: 'ready' });
    })();
  </script>
</body>
</html>`;
  }
}
