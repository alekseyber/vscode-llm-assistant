// HistoryViewProvider — WebviewViewProvider для вкладки «История» в Activity Bar
// Слой 07 Product Shell: показывает таблицу запусков (чат, агент, edit)
// с фильтром по режиму и кнопкой очистки

import * as vscode from 'vscode';
import * as fs from 'fs';
import * as path from 'path';
import { RunHistoryStore, RunEntry } from '../../shared/RunHistoryStore';
import { computeRunStats, formatStatsLine } from '../../shared/runStats';

/** ID вида — регистрируется в package.json */
export const HISTORY_VIEW_TYPE = 'llmAssistant.history';

/**
 * HistoryViewProvider — отображает историю запусков агента и чата.
 * Используется как отдельная вкладка в Activity Bar, рядом с чатом.
 */
export class HistoryViewProvider implements vscode.WebviewViewProvider {
  private view?: vscode.WebviewView;
  private readonly store: RunHistoryStore;
  /** Корень расширения: от него строится путь к media/history-filters.js */
  private readonly extensionUri: vscode.Uri;

  /** Колбэк перехода к сессии чата (одиночный клик по строке истории) */
  onOpenSession?: (sessionId: string) => void;

  constructor(store: RunHistoryStore, extensionUri: vscode.Uri) {
    this.store = store;
    this.extensionUri = extensionUri;
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
    // Любая запись в историю (чат, агент, Edit, оркестратор) обновляет таблицу
    const subscription = this.store.onDidChange(() => this.refresh());
    webviewView.onDidDispose?.(() => subscription.dispose());
  }

  /** Обновить таблицу после новой записи */
  refresh(): void {
    if (this.view) {
      this.postMessage(this.buildRefreshMessage());
    }
  }

  private async handleMessage(message: any): Promise<void> {
    switch (message.type) {
      case 'ready':
        // Отправляем текущую историю при загрузке
        this.postMessage(this.buildRefreshMessage());
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
        // Двойной клик по строке — получаем детали запуска по ID
        if (message.runId) {
          const runs = this.store.getRuns();
          const entry = runs.find((r) => r.id === message.runId);
          if (entry) {
            this.postMessage({ type: 'runDetails', entry });
          }
        }
        break;

      case 'openSession':
        // Одиночный клик по строке — переходим в чат этой сессии
        if (message.sessionId) {
          this.onOpenSession?.(message.sessionId);
        }
        break;
    }
  }

  /** Сообщение refresh со сводкой по стоимости и падениям (P13). */
  private buildRefreshMessage(): { type: string; runs: RunEntry[]; stats: unknown; statsLine: string } {
    const runs = this.store.getRuns();
    const stats = computeRunStats(runs);
    return { type: 'refresh', runs, stats, statsLine: formatStatsLine(stats) };
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
  /**
   * Исходник фильтра из `media/history-filters.js` — вставляем в разметку, чтобы module
   * оставался отдельным файлом (его проверяют тесты), а webview не зависел от загрузки ресурсов.
   */
  private filtersSource(): string {
    const candidates = [
      path.join(this.extensionUri.fsPath, 'media', 'history-filters.js'),
      path.join(__dirname, '..', '..', '..', '..', 'media', 'history-filters.js'),
      path.join(__dirname, '..', 'media', 'history-filters.js'),
    ];
    for (const candidate of candidates) {
      if (fs.existsSync(candidate)) return fs.readFileSync(candidate, 'utf-8');
    }
    throw new Error('media/history-filters.js не найден — фильтр истории не загрузится');
  }

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
      position: relative;
      display: flex;
      flex-direction: column;
      height: 100vh;
      overflow: hidden;
    }
    .stats-line {
    padding: 6px 10px;
    font-size: 11px;
    color: var(--text-secondary);
    border-bottom: 1px solid var(--border);
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
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
    /* P9 S3: видно, что модель подставил роутер, а не пользователь */
    .auto-badge {
      display: inline-block;
      margin-left: 4px;
      padding: 1px 5px;
      border-radius: 3px;
      font-size: 10px;
      background: #6b5a1e;
      color: #f8e07c;
      cursor: help;
    }
    .empty-state {
      display: flex;
      align-items: center;
      justify-content: center;
      height: 100%;
      color: var(--text-secondary);
      font-style: italic;
      font-size: 13px;
    }
    .detail-overlay {
      position: absolute;
      inset: 0;
      z-index: 10;
    }
    .detail-backdrop {
      position: absolute;
      inset: 0;
      background: rgba(0, 0, 0, 0.45);
    }
    .detail-drawer {
      position: absolute;
      top: 0;
      right: 0;
      bottom: 0;
      width: 88%;
      background: var(--bg-secondary);
      border-left: 1px solid var(--border);
      box-shadow: -4px 0 14px rgba(0, 0, 0, 0.5);
      display: flex;
      flex-direction: column;
    }
    .detail-header {
      display: flex;
      align-items: center;
      justify-content: space-between;
      padding: 8px 10px;
      border-bottom: 1px solid var(--border);
      font-weight: 600;
      flex-shrink: 0;
    }
    .detail-body {
      flex: 1;
      overflow-y: auto;
      padding: 12px;
      font-size: 12px;
      line-height: 1.6;
    }
    .detail-body .label {
      color: var(--text-secondary);
      font-weight: 600;
    }
    .close-btn {
      background: none;
      border: none;
      color: var(--text-secondary);
      cursor: pointer;
      font-size: 16px;
    }
    .close-btn:hover {
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
    <label style="font-size:11px;color:var(--text-secondary)">Статус:</label>
    <select id="status-filter">
      <option value="all">Все</option>
      <option value="success">✅ Успех</option>
      <option value="error">❌ Ошибка</option>
      <option value="cancelled">⏹ Отменён</option>
      <option value="limit_exceeded">⚠️ Лимит</option>
      <option value="running">🔄 Идёт</option>
    </select>
    <button id="btn-clear" class="clear-btn" title="Очистить историю">🗑 Очистить</button>
  </div>
  <div class="stats-line" id="stats-line" title="Сводка по всем запускам: стоимость и доля ошибок">—</div>
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
  <div class="detail-overlay" id="detail-overlay" style="display:none">
    <div class="detail-backdrop" id="detail-backdrop"></div>
    <div class="detail-drawer">
      <div class="detail-header">
        <span>Детали запуска</span>
        <button class="close-btn" id="detail-close">✕</button>
      </div>
      <div class="detail-body" id="detail-body"></div>
    </div>
  </div>

  <script>${this.filtersSource()}</script>
  <script>
    (function() {
      const vscode = acquireVsCodeApi();
      let allRuns = [];
      let currentFilter = 'all';
      let currentStatus = 'all';

      const table = document.getElementById('history-table');
      const tableBody = document.getElementById('table-body');
      const emptyState = document.getElementById('empty-state');
      const modeFilter = document.getElementById('mode-filter');
      const btnClear = document.getElementById('btn-clear');
      const detailOverlay = document.getElementById('detail-overlay');
      const detailBody = document.getElementById('detail-body');
      const detailClose = document.getElementById('detail-close');
      const detailBackdrop = document.getElementById('detail-backdrop');
      let clickTimer = null;

      // --- Отправка сообщений в extension ---
      function post(msg) { vscode.postMessage(msg); }

      // --- Фильтрация ---
      modeFilter.addEventListener('change', function() {
        currentFilter = this.value;
        renderTable();
        updateFilterSuffix();
      });

      /** Фильтр по статусу: логика в media/history-filters.js, здесь только состояние и перерисовка. */
      const statusFilter = document.getElementById('status-filter');
      if (statusFilter) {
        statusFilter.addEventListener('change', function() {
          currentStatus = this.value;
          renderTable();
          updateFilterSuffix();
        });
      }

      // --- Очистка истории ---
      btnClear.addEventListener('click', function() {
        post({ type: 'clearHistory' });
      });

      // --- Рендер таблицы ---
      let lastStatsLine = '—';

      /** Сводка приходит с backend: она по всей истории, фильтр на неё не влияет. */
      function renderStats(msg) {
        lastStatsLine = msg && msg.statsLine ? msg.statsLine : '—';
        updateFilterSuffix();
      }

      /** Дописать к сводке, сколько строк показано при активном фильтре. */
      function updateFilterSuffix() {
        const el = document.getElementById('stats-line');
        if (!el) return;
        let text = lastStatsLine;
        const shown = HistoryFilters.filterRuns(allRuns, { mode: currentFilter, status: currentStatus }).length;
        text += HistoryFilters.filterSuffix(shown, allRuns.length, { mode: currentFilter, status: currentStatus });
        el.textContent = text;
        el.title = 'Сводка по всей истории: суммарная стоимость, средняя стоимость, доля ошибок';
      }

      function renderTable() {
        const filtered = HistoryFilters.filterRuns(allRuns, { mode: currentFilter, status: currentStatus });

        tableBody.innerHTML = '';
        if (filtered.length === 0) {
          table.style.display = 'none';
          emptyState.style.display = 'flex';
          emptyState.textContent = HistoryFilters.emptyStateText({ mode: currentFilter, status: currentStatus });
        } else {
          table.style.display = '';
          emptyState.style.display = 'none';

          filtered.forEach(function(run) {
            var tr = document.createElement('tr');
            tr.addEventListener('click', (function(runRef) {
              return function() {
                if (clickTimer) {
                  // Двойной клик — детали
                  clearTimeout(clickTimer);
                  clickTimer = null;
                  showDetails(runRef.id);
                } else {
                  // Одиночный клик — переход в чат (если есть сессия)
                  clickTimer = setTimeout(function() {
                    clickTimer = null;
                    if (runRef.sessionId) {
                      post({ type: 'openSession', sessionId: runRef.sessionId });
                    } else {
                      showDetails(runRef.id);
                    }
                  }, 250);
                }
              };
            })(run));

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
              '<td><span class="mode-badge ' + modeClass + '">' + modeLabel + '</span>' +
                (run.autoModel
                  ? '<span class="auto-badge" title="' + escapeHtml(run.routeReason || 'модель выбрана автоматически') + '">авто</span>'
                  : '') +
              '</td>' +
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

        detailBody.innerHTML =
          '<div><span class="label">ID:</span> ' + escapeHtml(entry.id) + '</div>' +
          '<div><span class="label">Дата:</span> ' + date + '</div>' +
          '<div><span class="label">Режим:</span> ' + modeLabel + '</div>' +
          '<div><span class="label">Провайдер:</span> ' + entry.provider + '</div>' +
          '<div><span class="label">Модель:</span> ' + entry.model +
            (entry.autoModel ? ' <span class="auto-badge">выбрана автоматически</span>' : '') + '</div>' +
          (entry.autoModel && entry.routeReason
            ? '<div><span class="label">Решение роутера:</span> ' + escapeHtml(entry.routeReason) + '</div>'
            : '') +
          '<div><span class="label">Задача:</span> ' + escapeHtml(entry.task) + '</div>' +
          '<div><span class="label">Шагов:</span> ' + entry.steps + '</div>' +
          (entry.tools ? '<div><span class="label">Инструменты:</span> ' + entry.tools + '</div>' : '') +
          '<div><span class="label">Токены (вход / выход):</span> ' + entry.tokensIn + ' / ' + entry.tokensOut + '</div>' +
          '<div><span class="label">Стоимость:</span> $' + entry.cost.toFixed(6) + '</div>' +
          (typeof entry.forecastUsd === 'number'
            ? '<div><span class="label">Прогноз / факт:</span> $' + entry.forecastUsd.toFixed(6) +
              ' / $' + entry.cost.toFixed(6) +
              // Процент считаем только при реальном расходе: у отменённого прогона факт $0,
              // и «0% прогноза» читается как ошибка оценки
              (entry.forecastUsd > 0 && entry.cost > 0
                ? ' <span class="label">(' + Math.round((entry.cost / entry.forecastUsd) * 100) + '% прогноза)</span>'
                : '') +
              '</div>'
            : '') +
          '<div><span class="label">Длительность:</span> ' + durationSec + ' сек</div>' +
          '<div><span class="label">Статус:</span> ' + statusLabel + '</div>' +
          (entry.error ? '<div><span class="label">Ошибка:</span> ' + escapeHtml(entry.error) + '</div>' : '');

        detailOverlay.style.display = '';
      }

      function closeDetails() {
        detailOverlay.style.display = 'none';
      }
      detailClose.addEventListener('click', closeDetails);
      detailBackdrop.addEventListener('click', closeDetails);

      // --- Обработка сообщений от extension ---
      window.addEventListener('message', function(event) {
        var msg = event.data;
        switch (msg.type) {
          case 'refresh':
            allRuns = msg.runs || [];
            renderStats(msg);
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
