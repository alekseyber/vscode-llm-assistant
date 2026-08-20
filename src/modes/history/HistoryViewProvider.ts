// HistoryViewProvider — WebviewViewProvider для вкладки «История» в Activity Bar
// Слой 07 Product Shell: показывает таблицу запусков (чат, агент, edit)
// с фильтром по режиму и кнопкой очистки

import * as vscode from 'vscode';
import { RunHistoryStore, RunEntry } from '../../shared/RunHistoryStore';

/** ID вида — регистрируется в package.json */
export const HISTORY_VIEW_TYPE = 'llmAssistant.history';

/**
 * HistoryViewProvider — отображает историю запусков агента и чата.
 * Используется как отдельная вкладка в Activity Bar, рядом с чатом.
 */
export class HistoryViewProvider implements vscode.WebviewViewProvider {
  private view?: vscode.WebviewView;
  private readonly store: RunHistoryStore;

  /** Колбэк перехода к сессии чата (двойной клик по строке истории) */
  onOpenSession?: (sessionId: string) => void;

  constructor(store: RunHistoryStore) {
    this.store = store;
  }

  resolveWebviewView(
    webviewView: vscode.WebviewView,
    _context: vscode.WebviewViewResolveContext,
    _token: vscode.CancellationToken,
  ): void {
    this.view = webviewView;

    webviewView.webview.options = {
      enableScripts: true,
    };

    webviewView.webview.html = this.getHtmlContent();
    webviewView.webview.onDidReceiveMessage((msg) => this.handleMessage(msg));
  }

  /** Обновить таблицу после новой записи */
  refresh(): void {
    if (this.view) {
      this.postMessage({ type: 'refresh', runs: this.store.getRuns() });
    }
  }

  private async handleMessage(message: any): Promise<void> {
    switch (message.type) {
      case 'ready':
        // Отправляем текущую историю при загрузке
        this.postMessage({ type: 'refresh', runs: this.store.getRuns() });
        break;

      case 'clearHistory':
        const answer = await vscode.window.showWarningMessage(
          'Очистить всю историю запусков?',
          { modal: true },
          'Да',
        );
        if (answer === 'Да') {
          this.store.clearHistory();
          this.refresh();
        }
        break;

      case 'getDetails':
        // Получаем детали запуска по ID
        if (message.runId) {
          const runs = this.store.getRuns();
          const entry = runs.find((r) => r.id === message.runId);
          if (entry) {
            this.postMessage({ type: 'runDetails', entry });
          }
        }
        break;

      case 'openSession':
        // Двойной клик по строке — переходим в чат этой сессии
        if (message.sessionId) {
          this.onOpenSession?.(message.sessionId);
        }
        break;
    }
  }

  private postMessage(msg: any): void {
    console.warn(`[History] postMessage: ${msg.type}`);
    if (this.view) {
      this.view.webview.postMessage(msg);
    } else {
      console.warn('[History] view is undefined!');
    }
  }

  /** HTML-контент для WebView истории */
  private getHtmlContent(): string {
    return `<!DOCTYPE html>
<html lang="ru">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <meta http-equiv="Content-Security-Policy"
        content="default-src 'none'; style-src 'unsafe-inline'; script-src 'unsafe-inline';" />
  <title>История запусков</title>
  <style>
    :root {
      --bg-primary: #1e1e1e;
      --bg-secondary: #252526;
      --bg-tertiary: #2d2d2d;
      --bg-hover: #333333;
      --text-primary: #cccccc;
      --text-secondary: #969696;
      --accent: #007acc;
      --border: #3c3c3c;
      --success: #4ec94e;
      --error: #f14c4c;
      --warning: #cca700;
      --cancelled: #969696;
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
      font-size: 12px;
      color: var(--text-primary);
      background: var(--bg-primary);
    }
    body {
      padding: 0;
      margin: 0;
      display: flex;
      flex-direction: column;
      height: 100vh;
      overflow: hidden;
    }
    .toolbar {
      display: flex;
      align-items: center;
      gap: 8px;
      padding: 8px 10px;
      background: var(--bg-secondary);
      border-bottom: 1px solid var(--border);
      flex-shrink: 0;
    }
    .toolbar select {
      padding: 4px 8px;
      font-size: 11px;
      background: var(--bg-primary);
      color: var(--text-primary);
      border: 1px solid var(--border);
      border-radius: 4px;
      outline: none;
    }
    .toolbar select:focus {
      outline: 1px solid var(--accent);
    }
    .toolbar button {
      padding: 4px 10px;
      font-size: 11px;
      background: var(--bg-tertiary);
      color: var(--text-primary);
      border: 1px solid var(--border);
      border-radius: 4px;
      cursor: pointer;
    }
    .toolbar button:hover {
      background: var(--bg-hover);
    }
    .toolbar .clear-btn {
      background: #5a1d1d;
      border-color: #8b3a3a;
      color: #f48771;
      margin-left: auto;
    }
    .toolbar .clear-btn:hover {
      background: #6b2525;
    }
    .table-container {
      flex: 1;
      overflow-y: auto;
    }
    table {
      width: 100%;
      border-collapse: collapse;
    }
    th, td {
      padding: 6px 8px;
      text-align: left;
      border-bottom: 1px solid var(--border);
      white-space: nowrap;
      overflow: hidden;
      text-overflow: ellipsis;
    }
    th {
      position: sticky;
      top: 0;
      background: var(--bg-secondary);
      font-weight: 600;
      font-size: 11px;
      color: var(--text-secondary);
      text-transform: uppercase;
      z-index: 1;
    }
    tr {
      cursor: pointer;
    }
    tr:hover {
      background: var(--bg-hover);
    }
    .status-success { color: var(--success); }
    .status-running { color: var(--warning); }
    .status-error { color: var(--error); }
    .status-cancelled { color: var(--cancelled); }
    .status-limit { color: var(--warning); }
    .mode-badge {
      display: inline-block;
      padding: 1px 6px;
      border-radius: 3px;
      font-size: 10px;
      font-weight: 600;
    }
    .mode-chat { background: #1e4a6b; color: #7cc4f8; }
    .mode-agent { background: #4a2e6b; color: #c4a4f8; }
    .mode-edit { background: #3e6b3e; color: #8cd88c; }
    .empty-state {
      display: flex;
      align-items: center;
      justify-content: center;
      height: 100%;
      color: var(--text-secondary);
      font-style: italic;
      font-size: 13px;
    }
    .detail-panel {
      padding: 12px;
      background: var(--bg-secondary);
      border-top: 1px solid var(--border);
      font-size: 12px;
      line-height: 1.6;
      flex-shrink: 0;
      max-height: 40vh;
      overflow-y: auto;
    }
    .detail-panel .label {
      color: var(--text-secondary);
      font-weight: 600;
    }
    .detail-panel .close-btn {
      float: right;
      background: none;
      border: none;
      color: var(--text-secondary);
      cursor: pointer;
      font-size: 16px;
    }
    .detail-panel .close-btn:hover {
      color: var(--text-primary);
    }
    ::-webkit-scrollbar { width: 6px; }
    ::-webkit-scrollbar-track { background: var(--bg-primary); }
    ::-webkit-scrollbar-thumb { background: var(--border); border-radius: 3px; }
  </style>
</head>
<body>
  <div class="toolbar">
    <label style="font-size:11px;color:var(--text-secondary)">Режим:</label>
    <select id="mode-filter">
      <option value="all">Все</option>
      <option value="chat">💬 Чат</option>
      <option value="agent">🤖 Агент</option>
      <option value="edit">✏️ Edit</option>
    </select>
    <button id="btn-clear" class="clear-btn" title="Очистить историю">🗑 Очистить</button>
  </div>
  <div class="table-container" id="table-container">
    <div class="empty-state" id="empty-state">История запусков пуста</div>
    <table id="history-table" style="display:none">
      <thead>
        <tr>
          <th>Дата</th>
          <th>Режим</th>
          <th>Задача</th>
          <th>Шаги</th>
          <th>Токены</th>
          <th>Статус</th>
        </tr>
      </thead>
      <tbody id="table-body"></tbody>
    </table>
  </div>
  <div class="detail-panel" id="detail-panel" style="display:none"></div>

  <script>
    (function() {
      const vscode = acquireVsCodeApi();
      let allRuns = [];
      let currentFilter = 'all';

      const table = document.getElementById('history-table');
      const tableBody = document.getElementById('table-body');
      const emptyState = document.getElementById('empty-state');
      const modeFilter = document.getElementById('mode-filter');
      const btnClear = document.getElementById('btn-clear');
      const detailPanel = document.getElementById('detail-panel');

      // --- Отправка сообщений в extension ---
      function post(msg) { vscode.postMessage(msg); }

      // --- Фильтрация ---
      modeFilter.addEventListener('change', function() {
        currentFilter = this.value;
        renderTable();
      });

      // --- Очистка истории ---
      btnClear.addEventListener('click', function() {
        post({ type: 'clearHistory' });
      });

      // --- Рендер таблицы ---
      function renderTable() {
        const filtered = currentFilter === 'all'
          ? allRuns
          : allRuns.filter(function(r) { return r.mode === currentFilter; });

        tableBody.innerHTML = '';
        if (filtered.length === 0) {
          table.style.display = 'none';
          emptyState.style.display = 'flex';
          emptyState.textContent = currentFilter === 'all'
            ? 'История запусков пуста'
            : 'Нет записей с выбранным фильтром';
        } else {
          table.style.display = '';
          emptyState.style.display = 'none';

          filtered.forEach(function(run) {
            var tr = document.createElement('tr');
            tr.addEventListener('click', function() { showDetails(run.id); });
            tr.addEventListener('dblclick', function() {
              if (run.sessionId) post({ type: 'openSession', sessionId: run.sessionId });
            });

            var date = new Date(run.timestamp).toLocaleString('ru-RU', {
              month:'2-digit', day:'2-digit', hour:'2-digit', minute:'2-digit'
            });

            var modeLabel = run.mode === 'agent' ? 'Агент' : run.mode === 'edit' ? 'Edit' : 'Чат';
            var modeClass = 'mode-' + run.mode;

            var statusText = run.status === 'running' ? '⏳ В работе'
              : run.status === 'success' ? '✓ Успех'
              : run.status === 'error' ? '✗ Ошибка'
              : run.status === 'cancelled' ? 'Отменён'
              : 'Лимит';
            var statusClass = 'status-' + (run.status === 'limit_exceeded' ? 'limit' : run.status);

            var taskText = run.task.length > 40 ? run.task.slice(0, 40) + '...' : run.task;
            var tokensText = (run.tokensIn + run.tokensOut) >= 1000
              ? Math.round((run.tokensIn + run.tokensOut) / 1000) + 'K'
              : String(run.tokensIn + run.tokensOut);

            tr.innerHTML =
              '<td>' + date + '</td>' +
              '<td><span class="mode-badge ' + modeClass + '">' + modeLabel + '</span></td>' +
              '<td title="' + escapeHtml(run.task) + '">' + escapeHtml(taskText) + '</td>' +
              '<td>' + run.steps + '</td>' +
              '<td>' + tokensText + '</td>' +
              '<td class="' + statusClass + '">' + statusText + '</td>';

            tableBody.appendChild(tr);
          });
        }
      }

      // --- Детали запуска ---
      function showDetails(runId) {
        post({ type: 'getDetails', runId: runId });
      }

      function renderDetails(entry) {
        var date = new Date(entry.timestamp).toLocaleString('ru-RU');
        var durationSec = (entry.duration / 1000).toFixed(1);
        var modeLabel = entry.mode === 'agent' ? '🤖 Агент'
          : entry.mode === 'edit' ? '✏️ Edit'
          : '💬 Чат';
        var statusLabel = entry.status === 'running' ? '⏳ В работе'
          : entry.status === 'success' ? '✓ Успех'
          : entry.status === 'error' ? '✗ Ошибка'
          : entry.status === 'cancelled' ? 'Отменён'
          : 'Превышен лимит';

        detailPanel.innerHTML =
          '<button class="close-btn" onclick="document.getElementById(\\'detail-panel\\').style.display=\\'none\\'">✕</button>' +
          '<div><span class="label">ID:</span> ' + entry.id + '</div>' +
          '<div><span class="label">Дата:</span> ' + date + '</div>' +
          '<div><span class="label">Режим:</span> ' + modeLabel + '</div>' +
          '<div><span class="label">Провайдер:</span> ' + entry.provider + '</div>' +
          '<div><span class="label">Модель:</span> ' + entry.model + '</div>' +
          '<div><span class="label">Задача:</span> ' + escapeHtml(entry.task) + '</div>' +
          '<div><span class="label">Шагов:</span> ' + entry.steps + '</div>' +
          '<div><span class="label">Токены (вход / выход):</span> ' + entry.tokensIn + ' / ' + entry.tokensOut + '</div>' +
          '<div><span class="label">Стоимость:</span> $' + entry.cost.toFixed(6) + '</div>' +
          '<div><span class="label">Длительность:</span> ' + durationSec + ' сек</div>' +
          '<div><span class="label">Статус:</span> ' + statusLabel + '</div>' +
          (entry.error ? '<div><span class="label">Ошибка:</span> ' + escapeHtml(entry.error) + '</div>' : '');

        detailPanel.style.display = '';
      }

      // --- Обработка сообщений от extension ---
      window.addEventListener('message', function(event) {
        var msg = event.data;
        switch (msg.type) {
          case 'refresh':
            allRuns = msg.runs || [];
            renderTable();
            break;
          case 'runDetails':
            if (msg.entry) {
              renderDetails(msg.entry);
            }
            break;
        }
      });

      function escapeHtml(str) {
        var div = document.createElement('div');
        div.appendChild(document.createTextNode(str));
        return div.innerHTML;
      }

      // --- Инициализация ---
      setTimeout(function() {
        post({ type: 'ready' });
      }, 100);
    })();
  </script>
</body>
</html>`;
  }
}
