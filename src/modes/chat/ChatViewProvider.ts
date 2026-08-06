// ChatViewProvider — WebviewViewProvider для боковой панели чата

import * as vscode from 'vscode';
import * as fs from 'fs';
import { ProviderManager } from '../../providers/manager';
import { ConversationManager } from './ConversationManager';
import { ChatMessage } from '../../providers/types';
import { loadAgentsMd } from '../../shared/AgentsMdLoader';
import { loadRoleAgentsMd, loadOrchestratorRoles } from '../../shared/RoleAgentsMdLoader';
import { loadToolAllowListConfig, isConfirmationRequired } from '../apply/ToolAllowList';
import { McpClient, loadMcpConfig } from '../apply/McpClient';
import { AgentWorker, AgentRole } from '../apply/AgentWorker';
import { AgentOrchestrator, MultiAgentTask } from '../apply/AgentOrchestrator';
import { RunHistoryStore, generateRunId, RunEntry } from '../../shared/RunHistoryStore';
import { HistoryViewProvider } from '../history/HistoryViewProvider';
import { OrchestratorViewProvider, OrchestratorTaskInfo, WorkerInfo } from '../orchestrator/OrchestratorViewProvider';

export class ChatViewProvider implements vscode.WebviewViewProvider {
  public static readonly viewType = 'llmAssistant.chat';
  private view?: vscode.WebviewView;
  private readonly context: vscode.ExtensionContext;
  private readonly providerManager: ProviderManager;
  private readonly conversationManager: ConversationManager;
  private readonly runHistoryStore: RunHistoryStore;
  private abortController: AbortController | null = null;
  private pendingImage: { fileName: string; base64: string; mimeType: string } | null = null;
  private readonly historyViewProvider?: HistoryViewProvider;
  private readonly orchestratorViewProvider?: OrchestratorViewProvider;
  private debugChannel: vscode.OutputChannel;

  constructor(ctx: vscode.ExtensionContext, pm: ProviderManager, cm: ConversationManager, runHistoryStore: RunHistoryStore, historyViewProvider?: HistoryViewProvider, orchestratorViewProvider?: OrchestratorViewProvider) {
    this.context = ctx;
    this.providerManager = pm;
    this.conversationManager = cm;
    this.runHistoryStore = runHistoryStore;
    this.historyViewProvider = historyViewProvider;
    this.orchestratorViewProvider = orchestratorViewProvider;
    this.debugChannel = vscode.window.createOutputChannel('LLM Assistant');
    ctx.subscriptions.push(this.debugChannel);
    // Авто-обновление провайдеров при изменении настроек
    ctx.subscriptions.push(
      vscode.workspace.onDidChangeConfiguration(e => {
        if (e.affectsConfiguration('llmAssistant.providers') || e.affectsConfiguration('llmAssistant.defaultProvider')) {
          this.providerManager.refresh();
          this.sendProviderListToWebview();
        }
      })
    );
  }

  resolveWebviewView(wv: vscode.WebviewView, _ctx: vscode.WebviewViewResolveContext, _t: vscode.CancellationToken): void {
    this.view = wv;
    wv.webview.options = {
      enableScripts: true,
      localResourceRoots: [
        vscode.Uri.joinPath(this.context.extensionUri, 'src', 'webviews', 'chat'),
        vscode.Uri.joinPath(this.context.extensionUri, 'node_modules'),
      ],
    };
    wv.webview.html = this.getHtmlForWebview();
    wv.webview.onDidReceiveMessage(m => this.handleWebviewMessage(m));
  }

  private async handleWebviewMessage(message: any): Promise<void> {
    switch (message.type) {
      case 'sendMessage':
        await this.handleSendMessage(message.text, message.mode, message.provider, message.model);
        break;
      case 'cancelRequest': this.handleCancelRequest(); break;
      case 'clearHistory': this.conversationManager.clearHistory(); this.sendSessionListToWebview(); break;
      case 'ready': this.sendHistoryToWebview(); this.sendSessionListToWebview(); this.sendProviderListToWebview(); break;
      case 'newSession': this.conversationManager.session.createSession(); this.sendHistoryToWebview(); this.sendSessionListToWebview(); break;
      case 'switchSession':
        if (message.sessionId) { this.conversationManager.session.switchTo(message.sessionId); this.sendHistoryToWebview(); this.sendSessionListToWebview(); }
        break;
      case 'listSessions': this.sendSessionListToWebview(); break;
      case 'attachFile':
        if (message.isImage && message.base64) {
          // Vision: сохраняем как контекст для следующего сообщения
          this.pendingImage = { fileName: message.fileName, base64: message.base64, mimeType: message.mimeType };
        } else {
          this.conversationManager.attachCodeContext({
            filePath: message.fileName,
            content: message.content,
          });
        }
        break;
      case 'deleteSession':
        if (message.sessionId) {
          this.conversationManager.session.deleteSession(message.sessionId);
          this.sendHistoryToWebview();
          this.sendSessionListToWebview();
        }
        break;
      case 'renameSession':
        if (message.sessionId && message.name) {
          this.conversationManager.session.renameSession(message.sessionId, message.name);
          this.sendSessionListToWebview();
        }
        break;
    }
  }

  private async handleSendMessage(text: string, mode = 'chat', providerName?: string, modelName?: string): Promise<void> {
    const config = vscode.workspace.getConfiguration('llmAssistant');
    const isVision = !!this.pendingImage;
    const isAgentMode = mode === 'agent';
    const runId = generateRunId();
    const startTime = Date.now();

    // Определяем провайдера и модель
    const provider = providerName ? this.providerManager.getProvider(providerName) : this.providerManager.getDefault();
    if (!provider) { this.postMessage({ type: 'error', text: 'Провайдер не настроен.' }); return; }
    const model = modelName || config.get<string>('defaultModel') || 'gpt-4o';

    // --- @orchestrate: запуск multi-agent оркестратора ---
    const orchestrateMatch = text.match(/^@orchestrate\s+(.+)/);
    if (orchestrateMatch && isAgentMode) {
      await this.handleOrchestrate(orchestrateMatch[1], provider, model);
      return;
    }

    const providerDisplayName = providerName || config.get<string>('defaultProvider') || 'unknown';

    // Авто-контекст — должен быть ПЕРЕД addMessage, чтобы прикрепиться к ТЕКУЩЕМУ сообщению
    if (isAgentMode || config.get<boolean>('chat.includeOpenFile', true)) {
      const editor = vscode.window.activeTextEditor;
      if (editor) {
        this.conversationManager.attachCodeContext({
          filePath: editor.document.fileName,
          content: editor.document.getText(),
        });
      }
    }

    // Не добавляем в историю сразу если будет vision (изображение добавится вместе с текстом)
    if (!isVision) {
      this.conversationManager.addMessage({ role: 'user', content: text });
    }

    this.postMessage({ type: 'userMessage', text });

    this.abortController = new AbortController();

    // Колбэк для уведомления WebView о ретраях
    const onRetry = (attempt: number, maxRetries: number, delayMs: number, _errorMsg: string) => {
      this.postMessage({
        type: 'retryStatus',
        attempt,
        maxRetries,
        delayMs,
        text: `Повторная попытка ${attempt}/${maxRetries}...`,
      });
    };

    let inTokens = 0;
    let outTokens = 0;

    try {
      const systemPrompt = await this.getSystemPrompt(mode, providerName);
      const historyMessages = await this.conversationManager.getMessagesForRequest(provider);
      const messages: any[] = historyMessages;
      if (messages.length === 0 || messages[0].role !== 'system') {
        messages.unshift({ role: 'system', content: systemPrompt });
      } else if (messages[0].content !== systemPrompt) {
        messages[0].content = systemPrompt;
      }

      // Оценка входных токенов (символы / 4)
      inTokens = Math.ceil(
        messages.reduce((s: number, m: any) =>
          s + (typeof m.content === 'string' ? m.content.length : JSON.stringify(m.content).length), 0) / 4);

      const debug = vscode.workspace.getConfiguration('llmAssistant').get<boolean>('debug', false);
      if (debug) {
        this.debugChannel.appendLine(`[DEBUG] === Отправка запроса (${mode}, ${messages.length} сообщений, ~${inTokens} токенов) ===`);
        for (let i = 0; i < messages.length; i++) {
          const m = messages[i];
          const content = typeof m.content === 'string' ? m.content : JSON.stringify(m.content);
          this.debugChannel.appendLine(`[DEBUG] [${i}] ${m.role}: ${content.slice(0, 300)}${content.length > 300 ? '...' : ''}`);
        }
      }

      // Vision: добавляем одно сообщение с текстом + изображением
      const openaiProvider = provider as any;
      if (isVision && openaiProvider.supportsVision) {
        const userMsg: any = { role: 'user', content: [
          { type: 'text', text },
          { type: 'image_url', image_url: { url: `data:${this.pendingImage!.mimeType};base64,${this.pendingImage!.base64}` } }
        ]};
        messages.push(userMsg);
        this.pendingImage = null;

        const stream = openaiProvider.chatWithVision(messages, { model, stream: true }, this.abortController.signal, onRetry);
        let full = '';
        for await (const chunk of stream) { full += chunk; this.postMessage({ type: 'streamChunk', text: chunk }); }
        this.postMessage({ type: 'done' });
        // Сохраняем в историю после успешного ответа
        this.conversationManager.addMessage({ role: 'user', content: text });
        this.conversationManager.addMessage({ role: 'assistant', content: full });
        outTokens = Math.ceil(full.length / 4);
        this.recordChatRun(runId, startTime, text, providerDisplayName, model, 'chat', inTokens, outTokens, 1, 'success');
        return;
      }

      this.pendingImage = null;

      if (mode === 'agent') {
        // Проверяем, поддерживает ли провайдер function calling
        const agentProvider = provider as any;
        if (!agentProvider.createWithTools) {
          this.postMessage({ type: 'error', text: `⚠️ Провайдер «${providerDisplayName}» не поддерживает режим Агента. Переключите провайдера на SiliconFlow или DeepSeek.` });
          this.conversationManager.addMessage({ role: 'assistant', content: `⚠️ Провайдер «${providerDisplayName}» не поддерживает режим Агента.` });
          this.recordChatRun(runId, startTime, text, providerDisplayName, model, 'agent', inTokens, 0, 0, 'error', 'Нет createWithTools');
          return;
        }
        await this.runAgentLoop(provider, model, messages, onRetry);
        this.recordChatRun(runId, startTime, text, providerDisplayName, model, 'agent', inTokens, 0, 1, 'success');
      } else {
        const stream = provider.chat(messages, { model, stream: true }, this.abortController.signal, onRetry);
        let full = '';
        for await (const chunk of stream) { full += chunk; this.postMessage({ type: 'streamChunk', text: chunk }); }
        this.postMessage({ type: 'done' });
        this.conversationManager.addMessage({ role: 'assistant', content: full });
        this.postTokens(messages, full, model);
        outTokens = Math.ceil(full.length / 4);
        this.recordChatRun(runId, startTime, text, providerDisplayName, model, 'chat', inTokens, outTokens, 1, 'success');
      }
    } catch (error: any) {
      const duration = Date.now() - startTime;
      if (error.name === 'AbortError') {
        this.postMessage({ type: 'cancelled' });
        this.recordChatRun(runId, startTime, text, providerDisplayName, model, isAgentMode ? 'agent' : 'chat', inTokens, 0, 0, 'cancelled');
      } else {
        this.postMessage({ type: 'error', text: `Ошибка: ${error.message}` });
        console.error('[ChatViewProvider]', error);
        this.recordChatRun(runId, startTime, text, providerDisplayName, model, isAgentMode ? 'agent' : 'chat', inTokens, 0, 0, 'error', error.message);
      }
    } finally { this.abortController = null; }
  }

  /** Записать запуск чата/агента в историю (слой 07 Product Shell) */
  private recordChatRun(
    runId: string,
    startTime: number,
    task: string,
    provider: string,
    model: string,
    mode: RunEntry['mode'],
    tokensIn: number,
    tokensOut: number,
    steps: number,
    status: RunEntry['status'],
    error?: string,
  ): void {
    const duration = Date.now() - startTime;
    // Приблизительная стоимость (цены по умолчанию)
    const prices: Record<string, { input: number; output: number }> = {
      'deepseek-chat': { input: 0.14, output: 0.28 },
      'deepseek-v4-pro': { input: 0.435, output: 0.87 },
      'deepseek-v4-flash': { input: 0.14, output: 0.28 },
      'gpt-4o': { input: 2.50, output: 10.00 },
    };
    const price = prices[model] || { input: 0.5, output: 1.0 };
    const cost = (tokensIn / 1_000_000) * price.input + (tokensOut / 1_000_000) * price.output;

    const entry: RunEntry = {
      id: runId,
      timestamp: startTime,
      mode,
      task: task.slice(0, 100),
      provider,
      model,
      steps,
      tokensIn,
      tokensOut,
      cost: Math.round(cost * 1e6) / 1e6,
      duration,
      status,
      ...(error ? { error } : {}),
    };

    this.runHistoryStore.recordRun(entry);
    this.historyViewProvider?.refresh();
  }

  /** ReAct-цикл с инструментами (только для агентного режима).
   *  Делегирует выполнение AgentWorker — общему движку для чат-агента и оркестратора. */
  private async runAgentLoop(provider: any, model: string, messages: any[], onRetry?: (attempt: number, maxRetries: number, delayMs: number, errorMsg: string) => void): Promise<void> {
    const MAX_ITER = 5;
    const allowListConfig = loadToolAllowListConfig();

    // --- Загрузка MCP-инструментов (только для интерактивного агента) ---
    const mcpTools: any[] = [];
    try {
      const mcpConfigs = loadMcpConfig();
      this.debugChannel.appendLine(`[DEBUG] MCP configs loaded: ${mcpConfigs.length}`);
      if (mcpConfigs.length > 0) {
        for (const cfg of mcpConfigs) {
          try {
            const client = new McpClient(cfg);
            const result = await client.connect();
            const rawMcpTools = result.tools.map((t: any) => ({
              type: 'function', function: { name: t.name, description: t.description, parameters: t.parameters }
            }));
            const filteredMcpTools = allowListConfig.allowedTools?.length
              ? rawMcpTools.filter((t: any) => allowListConfig.allowedTools!.includes(t.function.name)) : rawMcpTools;
            mcpTools.push(...filteredMcpTools);
            this.debugChannel.appendLine(`[INFO] MCP connected: ${cfg.name} (${filteredMcpTools.length}/${rawMcpTools.length} tools)`);
          } catch (err: any) {
            this.debugChannel.appendLine(`[WARN] MCP ${cfg.name}: ${err.message}`);
          }
        }
      }
    } catch (err: any) {
      this.debugChannel.appendLine(`[WARN] MCP config error: ${err.message}`);
    }

    // Создаём AgentWorker с колбэками для UI
    const worker = new AgentWorker(
      { name: 'chat-agent', systemPrompt: messages[0]?.content || '' },
      provider,
      {
        maxIterations: MAX_ITER,
        extraTools: mcpTools,
        enableSummary: true,
        onConfirm: async (toolName, args) => {
          if (isConfirmationRequired(toolName, allowListConfig)) {
            this.postMessage({ type: 'streamChunk', text: `\n⚠️ **${toolName}** требует подтверждения...\n` });
            return this.requestConfirmation(toolName, args);
          }
          return true;
        },
        onStep: (step) => {
          switch (step.type) {
            case 'tool_call':
              this.postMessage({ type: 'streamChunk', text: `\n🔧 **${step.toolName}**\n` });
              break;
            case 'tool_result':
              this.postMessage({ type: 'streamChunk', text: (step.toolResult || step.message) + '\n' });
              break;
          }
        },
      }
    );

    try {
      // worker.run с initialMessages — использует готовый массив (system + история + AGENTS.md)
      const result = await worker.run('', messages);

      // Финальный ответ
      this.postMessage({ type: 'streamChunk', text: result.answer });
      this.postMessage({ type: 'done' });
      this.conversationManager.addMessage({ role: 'assistant', content: result.answer });
      this.postTokens(messages, result.answer, model);
    } catch (error: any) {
      throw error; // Пробрасываем наверх — обрабатывается в handleSendMessage
    }
  }

  /** Запустить multi-agent оркестрацию по команде @orchestrate */
  private async handleOrchestrate(taskText: string, provider: any, model: string): Promise<void> {
    const orchestratorView = this.orchestratorViewProvider;
    if (!orchestratorView) {
      this.postMessage({ type: 'error', text: 'Оркестратор не доступен' });
      return;
    }

    // Загружаем роли из .llma/agents/*.md (динамически) или fallback
    const roles = loadOrchestratorRoles();

    const task: MultiAgentTask = {
      id: `orch_${Date.now()}`,
      goal: taskText,
      roles,
      strategy: 'sequential',
    };

    // Показываем задачу в панели оркестратора
    orchestratorView.showTask({
      taskId: task.id,
      goal: task.goal,
      strategy: task.strategy,
      workers: roles.map(r => ({
        roleName: r.name,
        status: 'pending' as const,
        steps: 0,
        inputTokens: 0,
        outputTokens: 0,
      })),
      totalWorkers: roles.length,
      completedWorkers: 0,
      progress: 0,
    });

    this.postMessage({ type: 'streamChunk', text: `🎭 **Оркестратор запущен** (${roles.length} воркеров: ${roles.map(r => r.name).join(' → ')})\n\n` });

    const orchestrator = new AgentOrchestrator(
      (msg) => { this.debugChannel.appendLine(`[Orchestrator] ${msg}`); },
      // onWorkerStart — стримим в чат: «🔄 architect работает...»
      (roleName) => {
        this.postMessage({ type: 'streamChunk', text: `\n🔄 **${roleName}** работает...\n` });
        orchestratorView.updateWorker(roleName, { status: 'running' });
      },
      // onWorkerDone — стримим: «✅ architect» или «❌ architect»
      (roleName, error) => {
        const status = error ? 'error' : 'done';
        orchestratorView.updateWorker(roleName, { status });
        if (error) {
          this.postMessage({ type: 'streamChunk', text: `❌ **${roleName}**: ${error}\n` });
        }
      },
    );

    // Отмечаем воркеров как running
    for (const role of roles) {
      orchestratorView.updateWorker(role.name, { status: 'pending' });
    }

    const result = await orchestrator.execute(task, provider);

    // Обновляем статусы и показываем результаты
    for (const wt of result.workers) {
      orchestratorView.updateWorker(wt.roleName, {
        status: wt.error ? 'error' : 'done',
        steps: wt.result.iterations,
        answer: wt.result.answer,
        error: wt.error,
        inputTokens: wt.result.inputTokens,
        outputTokens: wt.result.outputTokens,
      });

      this.postMessage({
        type: 'streamChunk',
        text: `\n### ${wt.roleName}${wt.error ? ' ❌' : ' ✅'}\n${wt.error ? `Ошибка: ${wt.error}` : wt.result.answer}\n`,
      });
    }

    this.postMessage({ type: 'streamChunk', text: `\n---\n🎭 **Оркестрация завершена.** Токенов: ${result.totalInputTokens}+${result.totalOutputTokens}\n` });
    this.postMessage({ type: 'done' });

    // Сохраняем ответ в историю
    this.conversationManager.addMessage({ role: 'user', content: `@orchestrate ${taskText}` });
    this.conversationManager.addMessage({ role: 'assistant', content: result.summary });
  }

  /** Запросить подтверждение у пользователя для опасной операции */
  private requestConfirmation(toolName: string, args: Record<string, unknown>): Promise<boolean> {
    return new Promise((resolve) => {
      const requestId = `confirm_${Date.now()}`;
      this.postMessage({
        type: 'confirmAction',
        requestId,
        toolName,
        filePath: args.path || '',
        content: args.content || '',
        oldStr: args.old_str || '',
        newStr: args.new_str || '',
      });

      const handler = (message: any) => {
        if (message.type === 'confirmResponse' && message.requestId === requestId) {
          this.view?.webview.onDidReceiveMessage((m) => {
            if (m === message) return; // уже обработали
          });
          resolve(message.approved === true);
        }
      };

      // Временно подписываемся на ответ
      const disposable = this.view?.webview.onDidReceiveMessage((m: any) => {
        if (m.type === 'confirmResponse' && m.requestId === requestId) {
          disposable?.dispose();
          resolve(m.approved === true);
        }
      });
    });
  }

  private postTokens(messages: any[], fullResponse: string, model: string): void {
    const inTokens = Math.ceil(messages.reduce((s: number, m: any) => s + (typeof m.content === 'string' ? m.content.length : JSON.stringify(m.content).length), 0) / 4);
    const outTokens = Math.ceil(fullResponse.length / 4);
    this.postMessage({ type: 'tokens', inputTokens: inTokens, outputTokens: outTokens, model });
  }

  private async getSystemPrompt(mode: string, providerName?: string): Promise<string> {
    const config = vscode.workspace.getConfiguration('llmAssistant');
    // Кастомный промпт провайдера (если указан в settings)
    let prompt: string;
    if (providerName) {
      const providersCfg = config.get<Record<string, any>>('providers') ?? {};
      const providerCfg = providersCfg[providerName] ?? {};
      if (providerCfg.systemPrompt) {
        prompt = providerCfg.systemPrompt;
      } else if (mode === 'agent') {
        prompt = config.get<string>('chat.agentSystemPrompt') ||
          'Ты — AI-агент в VS Code. Инструменты: list_files, search_files, read_file, write_file, replace_in_file. Отвечай кратко, по-русски.';
      } else {
        prompt = config.get<string>('chat.systemPrompt') ||
          'Ты — AI-ассистент в VS Code. Отвечай кратко, по-русски, по делу. Без воды. Формат: markdown.';
      }
    } else if (mode === 'agent') {
      prompt = config.get<string>('chat.agentSystemPrompt') ||
        'Ты — AI-агент в VS Code. Инструменты: list_files, search_files, read_file, write_file, replace_in_file. Отвечай кратко, по-русски.';
    } else {
      prompt = config.get<string>('chat.systemPrompt') ||
        'Ты — AI-ассистент в VS Code. Отвечай кратко, по-русски, по делу. Без воды. Формат: markdown.';
    }

    // Автоинжект AGENTS.md (слой 01 System Policy)
    const agentsMd = await loadAgentsMd();
    if (agentsMd) {
      prompt += `\n\n## Правила проекта (AGENTS.md):\n${agentsMd}`;
    }

    const debug = vscode.workspace.getConfiguration('llmAssistant').get<boolean>('debug', false);
    if (debug) {
      this.debugChannel.appendLine(`[DEBUG] === System Prompt (${mode} mode) ===`);
      this.debugChannel.appendLine(prompt);
      this.debugChannel.appendLine('[DEBUG] === Конец System Prompt ===');
    }

    return prompt;
  }

  private handleCancelRequest(): void { if (this.abortController) { this.abortController.abort(); this.abortController = null; } }
  private sendHistoryToWebview(): void { if (this.view) this.postMessage({ type: 'history', messages: this.conversationManager.getMessages() }); }
  private sendSessionListToWebview(): void {
    if (!this.view) return;
    this.postMessage({ type: 'sessionList', sessions: this.conversationManager.session.listSessions(), activeId: this.conversationManager.session.getActive()?.meta.id });
  }
  private sendProviderListToWebview(): void {
    if (!this.view) return;
    const config = vscode.workspace.getConfiguration('llmAssistant');
    const providersConfig = config.get<Record<string, any>>('providers') ?? {};
    const providers: Record<string, { models: string[] }> = {};
    for (const [name, cfg] of Object.entries(providersConfig)) providers[name] = { models: cfg.models ?? [] };
    this.postMessage({ type: 'providerList', providers, defaultProvider: config.get<string>('defaultProvider') ?? '' });
  }
  private postMessage(m: any): void { if (this.view) this.view.webview.postMessage(m); }

  private getHtmlForWebview(): string {
    try {
      const base = this.context.extensionUri;
      const htmlPath = vscode.Uri.joinPath(base, 'src', 'webviews', 'chat', 'index.html');
      let html = fs.readFileSync(htmlPath.fsPath, 'utf-8');
      html = html.replace('{{STYLES}}', fs.readFileSync(vscode.Uri.joinPath(base, 'src', 'webviews', 'chat', 'styles.css').fsPath, 'utf-8'));
      html = html.replace('{{MARKED_LIB}}', fs.readFileSync(vscode.Uri.joinPath(base, 'src', 'webviews', 'chat', 'marked.min.js').fsPath, 'utf-8'));
      html = html.replace('{{SCRIPT}}', fs.readFileSync(vscode.Uri.joinPath(base, 'src', 'webviews', 'chat', 'main.js').fsPath, 'utf-8'));
      return html;
    } catch { return '<html><body><h1>Ошибка загрузки чата</h1></body></html>'; }
  }
}
