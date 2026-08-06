// OrchestratorViewProvider — WebviewViewProvider для вкладки «Оркестратор» (задача MA-4)
// Показывает дерево multi-agent задач: статус воркеров, прогресс-бар, детали шагов.

import * as vscode from 'vscode';

/** ID вида — регистрируется в package.json */
export const ORCHESTRATOR_VIEW_TYPE = 'llmAssistant.orchestrator';

/** Статус воркера */
export type WorkerStatus = 'pending' | 'running' | 'done' | 'error';

/** Информация о воркере для UI */
export interface WorkerInfo {
  roleName: string;
  status: WorkerStatus;
  steps: number;
  answer?: string;
  error?: string;
  inputTokens: number;
  outputTokens: number;
}

/** Информация о multi-agent задаче для UI */
export interface OrchestratorTaskInfo {
  taskId: string;
  goal: string;
  strategy: string;
  workers: WorkerInfo[];
  totalWorkers: number;
  completedWorkers: number;
  progress: number; // 0-100
}

/**
 * OrchestratorViewProvider — вкладка «Оркестратор» в Activity Bar.
 * Отображает текущую multi-agent задачу, дерево воркеров, прогресс.
 */
export class OrchestratorViewProvider implements vscode.WebviewViewProvider {
  private view?: vscode.WebviewView;
  private currentTask: OrchestratorTaskInfo | null = null;

  resolveWebviewView(
    webviewView: vscode.WebviewView,
    _context: vscode.WebviewViewResolveContext,
    _token: vscode.CancellationToken,
  ): void {
    this.view = webviewView;

    webviewView.webview.options = {
      enableScripts: true,
      localResourceRoots: [],
    };

    webviewView.webview.html = this.getHtml();
    this.setupMessageHandlers();
  }

  /** Показать новую задачу */
  showTask(task: OrchestratorTaskInfo): void {
    this.currentTask = task;
    this.postMessage({ type: 'taskUpdate', task });
  }

  /** Обновить статус конкретного воркера */
  updateWorker(roleName: string, updates: Partial<WorkerInfo>): void {
    if (!this.currentTask) return;
    const worker = this.currentTask.workers.find(w => w.roleName === roleName);
    if (!worker) return;
    Object.assign(worker, updates);
    this.recalcProgress();
    this.postMessage({ type: 'workerUpdate', roleName, updates });
  }

  /** Обновить прогресс-бар */
  private recalcProgress(): void {
    if (!this.currentTask) return;
    const done = this.currentTask.workers.filter(w => w.status === 'done' || w.status === 'error').length;
    this.currentTask.completedWorkers = done;
    this.currentTask.progress = Math.round((done / this.currentTask.totalWorkers) * 100);
  }

  /** Очистить панель */
  clear(): void {
    this.currentTask = null;
    this.postMessage({ type: 'clear' });
  }

  private postMessage(msg: any): void {
    this.view?.webview.postMessage(msg);
  }

  private setupMessageHandlers(): void {
    this.view?.webview.onDidReceiveMessage((msg: any) => {
      switch (msg.type) {
        case 'ready':
          // WebView загружен — отправляем текущую задачу
          if (this.currentTask) {
            this.postMessage({ type: 'taskUpdate', task: this.currentTask });
          }
          break;
        case 'expandWorker':
          // Клик по воркеру — отправить детали
          this.postMessage({
            type: 'workerDetail',
            roleName: msg.roleName,
            worker: this.currentTask?.workers.find(w => w.roleName === msg.roleName),
          });
          break;
      }
    });
  }

  private getHtml(): string {
    return `<!DOCTYPE html>
<html><head><meta charset="UTF-8"><style>
*{margin:0;padding:0;box-sizing:border-box}
body{font:13px -apple-system,BlinkMacSystemFont,sans-serif;color:var(--vscode-foreground);background:var(--vscode-sideBar-background);padding:12px}
h2{font-size:14px;margin:0 0 8px;color:var(--vscode-foreground)}
.goal{font-size:12px;color:var(--vscode-descriptionForeground);margin:0 0 12px;padding:8px;background:var(--vscode-input-background);border-radius:4px}
.progress-bar{width:100%;height:6px;background:var(--vscode-input-background);border-radius:3px;margin:0 0 12px;overflow:hidden}
.progress-fill{height:100%;background:var(--vscode-progressBar-background);transition:width .3s;border-radius:3px}
.progress-text{font-size:11px;color:var(--vscode-descriptionForeground);margin:-8px 0 12px;text-align:right}
.worker{border:1px solid var(--vscode-panel-border);border-radius:4px;margin:0 0 6px;overflow:hidden}
.worker-header{display:flex;align-items:center;padding:8px 10px;cursor:pointer;gap:8px}
.worker-header:hover{background:var(--vscode-list-hoverBackground)}
.worker-name{flex:1;font-weight:600}
.worker-status{font-size:11px;padding:2px 6px;border-radius:3px;font-weight:600}
.status-pending{background:var(--vscode-badge-background);color:var(--vscode-badge-foreground)}
.status-running{background:#3794ff;color:#fff}
.status-done{background:#89d185;color:#000}
.status-error{background:#f14c4c;color:#fff}
.worker-detail{display:none;padding:8px 10px;border-top:1px solid var(--vscode-panel-border);font-size:12px;background:var(--vscode-input-background)}
.worker-detail.open{display:block}
.worker-steps{color:var(--vscode-descriptionForeground);margin:0 0 4px}
.worker-answer{white-space:pre-wrap;color:var(--vscode-foreground);margin:0 0 4px;max-height:200px;overflow-y:auto}
.worker-tokens{font-size:11px;color:var(--vscode-descriptionForeground)}
.worker-error{color:#f14c4c;margin:4px 0}
.empty-state{text-align:center;color:var(--vscode-descriptionForeground);padding:40px 20px;font-size:13px}
.empty-icon{font-size:32px;margin:0 0 8px}
</style></head><body>
<div id="empty-state" class="empty-state">
  <div class="empty-icon">🎭</div>
  <div>Оркестратор не запущен</div>
  <div style="font-size:11px;margin-top:4px">Используйте 🤖 Агент с multi-agent задачей</div>
</div>
<div id="task-view" style="display:none">
  <h2 id="task-title">🎭 Оркестратор</h2>
  <div class="goal" id="task-goal"></div>
  <div class="progress-bar"><div class="progress-fill" id="progress-fill" style="width:0%"></div></div>
  <div class="progress-text" id="progress-text">0 / 0</div>
  <div id="workers"></div>
</div>
<script>
const vscode = acquireVsCodeApi();
let currentTask = null;
let expandedWorker = null;

vscode.postMessage({type:'ready'});

window.addEventListener('message', e => {
  const msg = e.data;
  switch(msg.type) {
    case 'taskUpdate':
      showTask(msg.task);
      break;
    case 'workerUpdate':
      updateWorkerUI(msg.roleName, msg.updates);
      break;
    case 'workerDetail':
      showDetail(msg.roleName, msg.worker);
      break;
    case 'clear':
      clearUI();
      break;
  }
});

function showTask(task) {
  currentTask = task;
  document.getElementById('empty-state').style.display = 'none';
  document.getElementById('task-view').style.display = 'block';
  document.getElementById('task-goal').textContent = task.goal;
  updateProgress(task);
  renderWorkers(task.workers);
}

function updateProgress(task) {
  document.getElementById('progress-fill').style.width = task.progress + '%';
  document.getElementById('progress-text').textContent = task.completedWorkers + ' / ' + task.totalWorkers;
}

function renderWorkers(workers) {
  const container = document.getElementById('workers');
  container.innerHTML = workers.map((w, i) => \`
    <div class="worker" id="worker-\${i}">
      <div class="worker-header" onclick="toggleWorker('\${i}', '\${w.roleName}')">
        <span class="worker-name">\${statusIcon(w.status)} \${w.roleName}</span>
        <span class="worker-status status-\${w.status}">\${statusLabel(w.status)}</span>
      </div>
      <div class="worker-detail" id="detail-\${i}">
        <div class="worker-steps">📊 Шагов: \${w.steps || 0} | Токенов: \${w.inputTokens}+\${w.outputTokens}</div>
        \${w.error ? '<div class="worker-error">❌ ' + esc(w.error) + '</div>' : ''}
        \${w.answer ? '<div class="worker-answer">' + esc(w.answer) + '</div>' : ''}
      </div>
    </div>
  \`).join('');
}

function updateWorkerUI(roleName, updates) {
  if (!currentTask) return;
  const idx = currentTask.workers.findIndex(w => w.roleName === roleName);
  if (idx < 0) return;
  Object.assign(currentTask.workers[idx], updates);
  updateProgress(currentTask);
  renderWorkers(currentTask.workers);
}

function toggleWorker(idx, roleName) {
  const detail = document.getElementById('detail-' + idx);
  detail.classList.toggle('open');
  vscode.postMessage({type:'expandWorker', roleName});
}

function showDetail(roleName, worker) {
  if (!worker) return;
  const idx = currentTask?.workers.findIndex(w => w.roleName === roleName);
  if (idx < 0) return;
  const detail = document.getElementById('detail-' + idx);
  if (detail) {
    detail.innerHTML = \`
      <div class="worker-steps">📊 Шагов: \${worker.steps || 0}</div>
      <div class="worker-tokens">🔤 Вход: \${worker.inputTokens} | Выход: \${worker.outputTokens}</div>
      \${worker.error ? '<div class="worker-error">❌ ' + esc(worker.error) + '</div>' : ''}
      \${worker.answer ? '<div class="worker-answer">' + esc(worker.answer) + '</div>' : ''}
    \`;
  }
}

function clearUI() {
  currentTask = null;
  document.getElementById('empty-state').style.display = 'block';
  document.getElementById('task-view').style.display = 'none';
}

function statusIcon(status) {
  switch(status) { case 'pending': return '⏳'; case 'running': return '🔄'; case 'done': return '✅'; case 'error': return '❌'; default: return '⬜'; }
}
function statusLabel(status) {
  switch(status) { case 'pending': return 'Ожидание'; case 'running': return 'Выполняется'; case 'done': return 'Готово'; case 'error': return 'Ошибка'; default: return status; }
}
function esc(s) { return (s || '').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;'); }
</script>
</body></html>`;
  }
}
