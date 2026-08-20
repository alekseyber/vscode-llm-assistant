// ReviewPanel — широкое окно (WebviewPanel) для полного отчёта код-ревью.
// Открывается по клику на компактной строке во вкладке «Ревью» (ReviewViewProvider).

import * as vscode from 'vscode';
import * as fs from 'fs';

export class ReviewPanel {
  /** Текущий инстанс панели (singleton) */
  public static currentPanel: ReviewPanel | undefined;

  private readonly panel: vscode.WebviewPanel;

  /** Создать панель или показать существующую с новым отчётом */
  public static createOrShow(
    context: vscode.ExtensionContext,
    filePath: string,
    report: string,
    cost: number,
  ): ReviewPanel {
    const column = vscode.window.activeTextEditor?.viewColumn ?? vscode.ViewColumn.One;

    // Панель уже есть — показываем и обновляем отчёт
    if (ReviewPanel.currentPanel) {
      ReviewPanel.currentPanel.panel.reveal(column);
      ReviewPanel.currentPanel.setReport(filePath, report, cost);
      return ReviewPanel.currentPanel;
    }

    const panel = vscode.window.createWebviewPanel(
      'llmAssistant.reviewPanel',
      'LLM Assistant — Ревью',
      column || vscode.ViewColumn.One,
      {
        enableScripts: true,
        retainContextWhenHidden: true,
      },
    );

    const reviewPanel = new ReviewPanel(panel, context, filePath, report, cost);
    ReviewPanel.currentPanel = reviewPanel;
    return reviewPanel;
  }

  private constructor(
    panel: vscode.WebviewPanel,
    context: vscode.ExtensionContext,
    filePath: string,
    report: string,
    cost: number,
  ) {
    this.panel = panel;
    this.panel.webview.html = this.getHtml(context);

    // При готовности WebView отправляем отчёт
    this.panel.webview.onDidReceiveMessage(
      (msg) => {
        if (msg.type === 'ready') {
          this.setReport(filePath, report, cost);
        }
      },
      undefined,
      context.subscriptions,
    );

    this.panel.onDidDispose(
      () => {
        ReviewPanel.currentPanel = undefined;
      },
      undefined,
      context.subscriptions,
    );
  }

  private setReport(filePath: string, report: string, cost: number): void {
    this.panel.webview.postMessage({ type: 'showReview', filePath, report, cost });
  }

  /** HTML широкого окна ревью: заголовок + markdown-отчёт */
  private getHtml(context: vscode.ExtensionContext): string {
    let markedLib = '';
    try {
      markedLib = fs.readFileSync(
        vscode.Uri.joinPath(context.extensionUri, 'src', 'webviews', 'chat', 'marked.min.js').fsPath,
        'utf-8',
      );
    } catch {
      markedLib = 'window.marked={parse:function(t){return "<pre>"+t+"</pre>";}};';
    }

    return `<!DOCTYPE html>
<html lang="ru">
<head>
  <meta charset="UTF-8" />
  <meta http-equiv="Content-Security-Policy"
        content="default-src 'none'; style-src 'unsafe-inline'; script-src 'unsafe-inline';" />
  <title>Ревью</title>
  <style>
    :root {
      --bg: #1e1e1e;
      --bg-head: #252526;
      --text: #cccccc;
      --text-dim: #969696;
      --accent: #007acc;
      --border: #3c3c3c;
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
      font-size: 14px;
      color: var(--text);
      background: var(--bg);
    }
    body { margin: 0; padding: 0; display: flex; flex-direction: column; height: 100vh; overflow: hidden; }
    .header {
      padding: 12px 20px;
      background: var(--bg-head);
      border-bottom: 1px solid var(--border);
      flex-shrink: 0;
    }
    .header .title { font-weight: 600; font-size: 15px; }
    .header .file { color: var(--text-dim); font-size: 12px; margin-top: 3px; word-break: break-all; }
    .header .cost { color: var(--accent); font-size: 12px; margin-top: 2px; }
    .report {
      flex: 1;
      overflow-y: auto;
      padding: 16px 24px;
      line-height: 1.7;
      max-width: 900px;
      margin: 0 auto;
      width: 100%;
      box-sizing: border-box;
    }
    .report h1, .report h2, .report h3 { margin: 16px 0 8px; }
    .report code { background: #2d2d2d; padding: 2px 5px; border-radius: 3px; font-size: 13px; }
    .report pre { background: #2d2d2d; padding: 12px; border-radius: 5px; overflow-x: auto; }
    .report pre code { background: none; padding: 0; }
    .report ul, .report ol { padding-left: 24px; }
    .report li { margin: 5px 0; }
    .report blockquote { border-left: 3px solid var(--border); margin: 10px 0; padding-left: 14px; color: var(--text-dim); }
    ::-webkit-scrollbar { width: 8px; }
    ::-webkit-scrollbar-thumb { background: var(--border); border-radius: 4px; }
  </style>
</head>
<body>
  <div class="header">
    <div class="title">🔍 Код-ревью</div>
    <div class="file" id="file-path"></div>
    <div class="cost" id="cost"></div>
  </div>
  <div class="report" id="report"></div>

  <script>
${markedLib}
  </script>
  <script>
    (function() {
      const vscode = acquireVsCodeApi();
      const fileEl = document.getElementById('file-path');
      const costEl = document.getElementById('cost');
      const reportEl = document.getElementById('report');

      window.addEventListener('message', function(event) {
        const msg = event.data;
        if (msg.type === 'showReview') {
          fileEl.textContent = msg.filePath || '(без файла)';
          costEl.textContent = msg.cost > 0 ? 'Стоимость: $' + msg.cost.toFixed(6) : '';
          reportEl.innerHTML = window.marked.parse(msg.report, { breaks: true, gfm: false });
        }
      });

      vscode.postMessage({ type: 'ready' });
    })();
  </script>
</body>
</html>`;
  }
}
