// ChatViewProvider — WebviewViewProvider для боковой панели чата
// Plan Mode: ветвление handleSendMessage → PlanModeManager (v0.9.0)

import * as vscode from 'vscode';
import * as fs from 'fs';
import * as path from 'path';
import { ProviderManager } from '../../providers/manager';
import { ConversationManager } from './ConversationManager';
import { ChatMessage, calculateCost } from '../../providers/types';
import { loadAgentsMd } from '../../shared/AgentsMdLoader';
import { loadRoleAgentsMd, loadOrchestratorRoles, loadAllAgentRoles, getSkillTemplate, loadSkillMd, getSkillCatalog } from '../../shared/RoleAgentsMdLoader';
import { loadToolAllowListConfig, isConfirmationRequired } from '../apply/ToolAllowList';
import { McpClient, loadMcpConfig } from '../apply/McpClient';
import { AgentWorker, AgentRole } from '../apply/AgentWorker';
import { AgentOrchestrator, MultiAgentTask, MultiAgentResult } from '../apply/AgentOrchestrator';
import { RunHistoryStore, generateRunId, RunEntry } from '../../shared/RunHistoryStore';
import { SessionLog } from '../../shared/SessionLog';
import { isAbortError } from '../../shared/RetryHandler';
import { buildThinkingExtraBody } from '../../shared/thinking';
import { HistoryViewProvider } from '../history/HistoryViewProvider';
import { OrchestratorViewProvider, OrchestratorTaskInfo, WorkerInfo } from '../orchestrator/OrchestratorViewProvider';
import { setDelegateHandler } from './ChatAgentTools';
import { PlanModeManager } from './PlanModeManager';
import { parseSlashCommand, getSlashCommand, SLASH_COMMANDS } from './SlashCommands';

export class ChatViewProvider implements vscode.WebviewViewProvider {
  public static readonly viewType = 'llmAssistant.chat';
  private view?: vscode.WebviewView;
  private readonly context: vscode.ExtensionContext;
  private readonly providerManager: ProviderManager;
  private readonly conversationManager: ConversationManager;
  private readonly runHistoryStore: RunHistoryStore;
  private readonly sessionLog?: SessionLog;
  /** Контроллеры отмены по сессии — поддержка параллельных процессов */
  private abortControllers = new Map<string, AbortController>();
  private pendingImage: { fileName: string; base64: string; mimeType: string } | null = null;
  private readonly historyViewProvider?: HistoryViewProvider;
  private readonly orchestratorViewProvider?: OrchestratorViewProvider;
  private debugChannel: vscode.OutputChannel;

  constructor(ctx: vscode.ExtensionContext, pm: ProviderManager, cm: ConversationManager, runHistoryStore: RunHistoryStore, historyViewProvider?: HistoryViewProvider, orchestratorViewProvider?: OrchestratorViewProvider, sessionLog?: SessionLog) {
    this.context = ctx;
    this.providerManager = pm;
    this.conversationManager = cm;
    this.runHistoryStore = runHistoryStore;
    this.sessionLog = sessionLog;
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

  /** Разрешить эффективный ID сессии для session-log (F1): переданный или активный */
  private resolveSessionId(sessionId?: string): string | undefined {
    return sessionId || this.conversationManager.session.getActive()?.meta.id;
  }

  /** Записать чанк ассистента в session-log (троттлинг по длине буфера) — F1 SL-5 */
  private logStreamChunk(sessionId: string | undefined, chunk: string, buffer: { acc: string }): void {
    const sid = this.resolveSessionId(sessionId);
    if (!sid || !this.sessionLog) return;
    buffer.acc += chunk;
    if (buffer.acc.length >= 200) {
      this.sessionLog.append({ sessionId: sid, ts: Date.now(), type: 'assistant/chunk', delta: buffer.acc });
      buffer.acc = '';
    }
  }

  /** Добить буфер чанков в лог (assistant/message пишет addMessageTo — F1 5a) */
  private flushChunkBuffer(sessionId: string | undefined, buffer: { acc: string }): void {
    const sid = this.resolveSessionId(sessionId);
    if (!sid || !this.sessionLog) return;
    if (buffer.acc) {
      this.sessionLog.append({ sessionId: sid, ts: Date.now(), type: 'assistant/chunk', delta: buffer.acc });
      buffer.acc = '';
    }
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
        await this.handleSendMessage(message.text, message.mode, message.provider, message.model, message.planMode, message.sessionId);
        break;
      case 'implementPlan':
        await this.handleImplementPlan(message.planPath, message.provider, message.model, message.sessionId);
        break;
      case 'cancelRequest': this.handleCancelRequest(message.sessionId); break;
      case 'clearHistory': this.conversationManager.clearHistory(); this.sendSessionListToWebview(); break;
      case 'clearAllSessions':
        // Удалить все сессии и логи — переиспользуем модальный флоу команды (без дублирования).
        await vscode.commands.executeCommand('llmAssistant.clearAllSessions');
        break;
      case 'ready': this.sendHistoryToWebview(); this.sendSessionListToWebview(); this.sendProviderListToWebview(); this.sendSlashCommandsToWebview(); this.restoreTokenIndicator(); break;
      case 'newSession': this.conversationManager.session.createSession(); this.sendHistoryToWebview(); this.sendSessionListToWebview(); break;
      case 'switchSession':
        if (message.sessionId) { this.conversationManager.session.switchTo(message.sessionId); this.sendHistoryToWebview(); this.sendSessionListToWebview(); this.restoreTokenIndicator(message.sessionId); }
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
          this.sessionLog?.deleteSession(message.sessionId);
          // Очищаем привязку запусков истории к удалённой сессии (иначе двойной клик ведёт в «мёртвую» сессию)
          this.runHistoryStore.clearSessionReferences(message.sessionId);
          this.historyViewProvider?.refresh();
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
      case 'toggleFavorite':
        if (message.sessionId) {
          this.conversationManager.session.toggleFavorite(message.sessionId);
          this.sendSessionListToWebview();
        }
        break;
      case 'getTranscript': {
        const sid = (message.sessionId as string) || this.conversationManager.session.getActive()?.meta.id;
        if (sid && this.sessionLog) {
          this.postMessage({ type: 'sessionTranscript', text: this.sessionLog.toTranscript(sid), action: message.action || 'copy' });
        }
        break;
      }
    }
  }

  /** Переключить активную сессию чата (вызывается из вкладки «История» по двойному клику) */
  public switchToSession(sessionId: string): void {
    const exists = this.conversationManager.session.listSessions().some(s => s.id === sessionId);
    if (!exists) {
      vscode.window.showWarningMessage('Эта сессия удалена — чат недоступен.');
      return;
    }
    this.conversationManager.session.switchTo(sessionId);
    this.sendHistoryToWebview();
    this.sendSessionListToWebview();
    this.restoreTokenIndicator(sessionId);
    // Фокусируем вкладку чата (reveal) — иначе переключение сессии не видно
    this.view?.show(true);
  }

  /** Обновить список сессий + историю в WebView (для fork и внешних изменений) */
  public refreshSessionList(): void {
    this.sendHistoryToWebview();
    this.sendSessionListToWebview();
  }

  /** Показать/сфокусировать вкладку чата (для llmAssistant.chat.focus — вместо легаси ChatPanel) */
  public reveal(): void {
    this.view?.show(true);
  }

  private async handleSendMessage(text: string, mode = 'chat', providerName?: string, modelName?: string, planMode?: boolean, sessionId?: string): Promise<void> {
    const config = vscode.workspace.getConfiguration('llmAssistant');
    const isVision = !!this.pendingImage;
    const isAgentMode = mode === 'agent';
    const runId = generateRunId();
    const startTime = Date.now();

    // Определяем провайдера и модель
    const provider = providerName ? this.providerManager.getProvider(providerName) : this.providerManager.getDefault();
    if (!provider) { this.postMessage({ type: 'error', text: 'Провайдер не настроен.' }); return; }
    const model = (typeof modelName === 'object' && modelName !== null ? (modelName as any).name : modelName) || config.get<string>('defaultModel') || 'gpt-4o';

    // --- @orchestrate: запуск multi-agent оркестратора ---
    const orchestrateMatch = text.match(/^@orchestrate\s+(.+)/);
    if (orchestrateMatch && isAgentMode) {
      await this.handleOrchestrate(orchestrateMatch[1], provider, model, sessionId);
      return;
    }

    // --- /skill и слэш-команды код-действий (Агент и Чат, кроме Plan Mode) ---
    let skillContent: string | null = null;
    let slashPrompt: string | null = null;
    let slashWrites = false;
    const slashMatch = parseSlashCommand(text);
    if (slashMatch && !planMode) {
      // 1) Скил по имени (.llma/skills/{name}.md) — обратная совместимость /skill
      skillContent = loadSkillMd(slashMatch.name);
      if (skillContent) {
        // Убираем /имя, оставляем только задачу (или дефолтную инструкцию)
        text = slashMatch.argument || `Действуй по правилам скила ${slashMatch.name}`;
      } else {
        // 2) Встроенная слэш-команда (/explain, /doc, /test, /review, /improve)
        const command = getSlashCommand(slashMatch.name);
        if (command) {
          slashPrompt = command.promptTemplate;
          slashWrites = command.writes;
          text = slashMatch.argument || command.defaultTask;
        }
      }
    }

    const providerDisplayName = providerName || config.get<string>('defaultProvider') || 'unknown';

    // Записываем запуск в историю со статусом 'running' (появится сразу, обновится по завершении).
    // Plan Mode записывает свой запуск в handlePlanMode/handleImplementPlan — иначе двойная запись.
    if (!(isAgentMode && planMode)) {
      this.recordRunStart(runId, startTime, text, providerDisplayName, model, isAgentMode ? 'agent' : 'chat', this.resolveSessionId(sessionId));
    }

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
      this.conversationManager.addMessageTo(sessionId, { role: 'user', content: text });
    }

    this.postMessage({ type: 'userMessage', text }, sessionId);

    const sid = sessionId || 'default';
    const abortController = new AbortController();
    this.abortControllers.set(sid, abortController);

    // Колбэк для уведомления WebView о ретраях
    const onRetry = (attempt: number, maxRetries: number, delayMs: number, _errorMsg: string) => {
      this.postMessage({
        type: 'retryStatus',
        attempt,
        maxRetries,
        delayMs,
        text: `Повторная попытка ${attempt}/${maxRetries}...`,
      }, sessionId);
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

      // ── Инжект скила: /coder → содержимое .llma/skills/coder.md ──
      if (skillContent) {
        messages.splice(1, 0, { role: 'system', content: `## Правила скила (обязательно к выполнению):\n${skillContent}` });
        this.debugChannel.appendLine(`[DEBUG] Инжект скила: ${skillContent.slice(0, 80)}...`);
      }

      // ── Инжект слэш-команды: /explain, /doc, /test, /review, /improve ──
      // Промпт НЕ содержит ⚠️, чтобы AgentWorker не удалил его при очистке инжекта (MA-1.11).
      if (slashPrompt) {
        let prompt = slashPrompt;
        // Команды записи (/doc, /test) в агентном режиме: принуждаем вызвать write_file,
        // а не выводить текст (DeepSeek склонен отвечать текстом вместо function calling).
        if (isAgentMode && slashWrites) {
          // Убираем инструкцию «в chat-режиме выведи текст» — она сбивает модель с толку
          prompt = prompt.replace(/[^\n]*В chat-режиме[^\n]*(\n|$)/g, '');
          prompt += '\n\n⚠️ ВАЖНО: ты в АГЕНТНОМ режиме (у тебя есть инструмент write_file). Инструкция «в chat-режиме выведи текст» к тебе НЕ относится — ИГНОРИРУЙ её. ЗАПИШИ результат в файл через write_file/replace_in_file. Вызови write_file СЕЙЧАС, НЕ выводи текст!';
          this.debugChannel.appendLine(`[DEBUG] write-директива добавлена (mode=${mode}, writes=${slashWrites})`);
        }
        messages.splice(1, 0, { role: 'system', content: prompt });
        this.debugChannel.appendLine(`[DEBUG] Инжект слэш-команды: ${slashPrompt.slice(0, 80)}...`);
      }

      // ── Принудительный ask_user: если пользователь явно просит спросить/уточнить ──
      const askUserTriggers = /(?:^|\s)(спроси|уточни|предложи\s+варианты|задай\s+вопрос|выясни|поинтересуйся)(?:\s|[?!.,]|$)/i;
      if (isAgentMode && askUserTriggers.test(text)) {
        const isYesNo = /(?:^|\s)(нужно|надо|стоит|следует|добавить|включить|сделать)(?:\s|[?!.]|$)/i.test(text);
        const instruction = isYesNo
          ? '⚠️ ВАЖНО: пользователь просит использовать инструмент ask_user. Это вопрос Да/Нет — ВЫЗОВИ ask_user с options: ["Да", "Нет"]. НЕ ОТВЕЧАЙ ТЕКСТОМ!'
          : '⚠️ ВАЖНО: пользователь просит использовать инструмент ask_user. НЕ ОТВЕЧАЙ ТЕКСТОМ — ВЫЗОВИ ask_user СЕЙЧАС.';
        messages.splice(1, 0, { role: 'system', content: instruction });
        this.debugChannel.appendLine(`[DEBUG] Принудительный ask_user: ${isYesNo ? 'Да/Нет' : 'открытый вопрос'}`);
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

        const stream = openaiProvider.chatWithVision(messages, { model, stream: true }, abortController.signal, onRetry);
        let full = '';
        const buffer = { acc: '' };
        for await (const chunk of stream) { full += chunk; this.postMessage({ type: 'streamChunk', text: chunk }, sessionId); this.logStreamChunk(sessionId, chunk, buffer); }
        this.postMessage({ type: 'done' }, sessionId);
        // Сохраняем в историю после успешного ответа
        this.conversationManager.addMessageTo(sessionId, { role: 'user', content: text });
        this.conversationManager.addMessageTo(sessionId, { role: 'assistant', content: full });
        this.flushChunkBuffer(sessionId, buffer);
        outTokens = Math.ceil(full.length / 4);
        this.finalizeRun(runId, startTime, model, providerDisplayName, inTokens, outTokens, 1, 'success');
        return;
      }

      this.pendingImage = null;

      // ── Plan Mode: ветвление для агента с планом ──
      if (isAgentMode && planMode) {
        await this.handlePlanMode(text, provider, model, sid, abortController.signal);
        return;
      }

      if (mode === 'agent') {
        // Проверяем, поддерживает ли провайдер function calling
        const agentProvider = provider as any;
        if (!agentProvider.createWithTools) {
          this.postMessage({ type: 'error', text: `⚠️ Провайдер «${providerDisplayName}» не поддерживает режим Агента. Переключите провайдера на SiliconFlow или DeepSeek.` }, sessionId);
          this.conversationManager.addMessageTo(sessionId, { role: 'assistant', content: `⚠️ Провайдер «${providerDisplayName}» не поддерживает режим Агента.` });
          this.finalizeRun(runId, startTime, model, providerDisplayName, inTokens, 0, 0, 'error', 'Нет createWithTools');
          return;
        }
        await this.runAgentLoop(provider, model, messages, onRetry, sid, abortController.signal);
        const runSteps = this.sessionLog?.computeStats(this.resolveSessionId(sessionId) ?? '')?.steps || 1;
        this.finalizeRun(runId, startTime, model, providerDisplayName, inTokens, 0, runSteps, 'success');
      } else {
        const stream = provider.chat(messages, { model, stream: true, extraBody: buildThinkingExtraBody(model) }, abortController.signal, onRetry);
        let full = '';
        const buffer = { acc: '' };
        for await (const chunk of stream) { full += chunk; this.postMessage({ type: 'streamChunk', text: chunk }, sessionId); this.logStreamChunk(sessionId, chunk, buffer); }
        this.postMessage({ type: 'done' }, sessionId);
        this.conversationManager.addMessageTo(sessionId, { role: 'assistant', content: full });
        this.flushChunkBuffer(sessionId, buffer);
        this.postTokens(messages, full, model);
        outTokens = Math.ceil(full.length / 4);
        this.finalizeRun(runId, startTime, model, providerDisplayName, inTokens, outTokens, 1, 'success');
      }
    } catch (error: any) {
      const duration = Date.now() - startTime;
      if (isAbortError(error)) {
        this.markCancelled(sessionId);
        this.finalizeRun(runId, startTime, model, providerDisplayName, inTokens, 0, 0, 'cancelled');
      } else {
        this.postMessage({ type: 'error', text: `Ошибка: ${error.message}` }, sessionId);
        console.error('[ChatViewProvider]', error);
        this.finalizeRun(runId, startTime, model, providerDisplayName, inTokens, 0, 0, 'error', error.message);
      }
    } finally { this.abortControllers.delete(sid); }
  }

  /** Записать запуск в историю со статусом 'running' (в начале выполнения) */
  private recordRunStart(
    runId: string,
    startTime: number,
    task: string,
    provider: string,
    model: string,
    mode: RunEntry['mode'],
    sessionId?: string,
  ): void {
    const entry: RunEntry = {
      id: runId,
      timestamp: startTime,
      mode,
      task: task.slice(0, 100),
      provider,
      model,
      steps: 0,
      tokensIn: 0,
      tokensOut: 0,
      cost: 0,
      duration: 0,
      status: 'running',
      ...(sessionId ? { sessionId } : {}),
    };

    this.runHistoryStore.recordRun(entry);
    this.historyViewProvider?.refresh();
    this.broadcastRunState(sessionId, true);
  }

  /**
   * Отмена по AbortSignal: уведомить WebView + персистить маркер «Запрос отменён» в session-log,
   * чтобы он не исчезал при переключении сессий.
   */
  private markCancelled(sessionId?: string): void {
    this.postMessage({ type: 'cancelled' }, sessionId);
    this.conversationManager.addMessageTo(sessionId, { role: 'assistant', content: '_Запрос отменён._' });
  }

  /** Обновить запуск в истории финальными значениями (по завершении) */
  private finalizeRun(
    runId: string,
    startTime: number,
    model: string,
    provider: string,
    tokensIn: number,
    tokensOut: number,
    steps: number,
    status: RunEntry['status'],
    error?: string,
  ): void {
    const duration = Date.now() - startTime;
    const cost = calculateCost(model, tokensIn, tokensOut, this.providerManager.pricingMap);

    this.runHistoryStore.updateRun(runId, {
      tokensIn,
      tokensOut,
      steps,
      duration,
      cost: Math.round(cost * 1e6) / 1e6,
      status,
      ...(error ? { error } : {}),
    });
    this.historyViewProvider?.refresh();
    this.broadcastRunState(this.runHistoryStore.getRun(runId)?.sessionId, false);
  }

  /** ReAct-цикл с инструментами (только для агентного режима).
   *  Делегирует выполнение AgentWorker — общему движку для чат-агента и оркестратора. */
  private async runAgentLoop(provider: any, model: string, messages: any[], onRetry?: (attempt: number, maxRetries: number, delayMs: number, errorMsg: string) => void, sessionId?: string, signal?: AbortSignal): Promise<void> {
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

    // Настраиваем делегирование для чат-агента
    const allRoles = loadAllAgentRoles();
    setDelegateHandler(async (role: string, task: string): Promise<string> => {
      const roleDef = allRoles.find(r => r.name === role);
      const subRole = roleDef || { name: role, systemPrompt: `Ты — ${role}. Отвечай кратко, по-русски.` };
      const subWorker = new AgentWorker(subRole, provider, { maxIterations: 15, extraTools: mcpTools });
      const result = await subWorker.run(task);
      return result.answer;
    });

    // Создаём AgentWorker с колбэками для UI
    const worker = new AgentWorker(
      { name: 'chat-agent', systemPrompt: messages[0]?.content || '' },
      provider,
      {
        maxIterations: MAX_ITER,
        extraTools: mcpTools,
        enableSummary: true,
        signal,
        sessionId: this.resolveSessionId(sessionId === 'default' ? undefined : sessionId),
        onEvent: (e) => this.sessionLog?.append(e),
        onConfirm: async (toolName, args) => {
          this.debugChannel.appendLine(`[DEBUG] onConfirm: toolName=${toolName}, requires=${isConfirmationRequired(toolName, allowListConfig)}`);
          if (isConfirmationRequired(toolName, allowListConfig)) {
            this.postMessage({ type: 'toolActivity', activity: { kind: 'note', text: `⚠️ ${toolName} требует подтверждения` } }, sessionId);
            const approved = await this.requestConfirmation(toolName, args);
            this.debugChannel.appendLine(`[DEBUG] onConfirm: toolName=${toolName}, approved=${approved}`);
            return approved;
          }
          return true;
        },
        onStep: (step) => {
          switch (step.type) {
            case 'tool_call':
              this.postMessage({ type: 'toolActivity', activity: { kind: 'start', toolName: step.toolName, args: step.args } }, sessionId);
              break;
            case 'tool_result':
              this.postMessage({ type: 'toolActivity', activity: { kind: 'result', toolName: step.toolName, text: step.toolResult || step.message } }, sessionId);
              break;
          }
        },
      }
    );

    // worker.run с initialMessages — использует готовый массив (system + история + AGENTS.md)
    const result = await worker.run('', messages);

    // Финальный ответ
    this.postMessage({ type: 'streamChunk', text: result.answer }, sessionId);
    this.postMessage({ type: 'done' }, sessionId);
    this.conversationManager.addMessageTo(sessionId, { role: 'assistant', content: result.answer });
    this.postTokens(messages, result.answer, model);
  }

  /** Plan Mode: генерация плана (Этап 1) */
  private async handlePlanMode(text: string, provider: any, model: string, sessionId?: string, signal?: AbortSignal): Promise<void> {
    const workspaceFolders = vscode.workspace.workspaceFolders;
    if (!workspaceFolders || workspaceFolders.length === 0) {
      this.postMessage({ type: 'error', text: 'Plan Mode требует открытый workspace.' }, sessionId);
      return;
    }
    const workspacePath = workspaceFolders[0].uri.fsPath;

    // Записываем запуск в историю со статусом 'running'
    const planRunId = generateRunId();
    const planStartTime = Date.now();
    this.recordRunStart(planRunId, planStartTime, text, 'plan-mode', model, 'agent', sessionId);

    this.postMessage({ type: 'streamChunk', text: '📋 **Генерирую план...**\n' }, sessionId);

    try {
      const planManager = new PlanModeManager(workspacePath, this.resolveSessionId(sessionId), (e) => this.sessionLog?.append(e));
      const planResult = await planManager.generatePlan(text, provider, model, signal);

      // Отправляем план в WebView
      this.postMessage({
        type: 'planGenerated',
        planContent: planResult.content,
        planPath: planResult.planPath,
      }, sessionId);

      // Сохраняем план в историю сессии — иначе теряется при переключении чата/восстановлении
      this.conversationManager.addMessageTo(sessionId, { role: 'assistant', content: `📋 **План:**\n\n${planResult.content}` });

      this.postMessage({ type: 'done' }, sessionId);
      this.finalizeRun(planRunId, planStartTime, model, 'plan-mode', 0, 0, 1, 'success');
    } catch (err: any) {
      if (isAbortError(err)) {
        this.markCancelled(sessionId);
        this.finalizeRun(planRunId, planStartTime, model, 'plan-mode', 0, 0, 0, 'cancelled');
      } else {
        this.postMessage({ type: 'error', text: `Ошибка планирования: ${err.message}` }, sessionId);
        this.finalizeRun(planRunId, planStartTime, model, 'plan-mode', 0, 0, 0, 'error', err.message);
      }
    }
  }

  /** Plan Mode: имплементация плана (Этап 2-3) */
  private async handleImplementPlan(planPath: string, providerName?: string, modelName?: string, sessionId?: string): Promise<void> {
    const config = vscode.workspace.getConfiguration('llmAssistant');
    const provider = this.providerManager.getProvider(providerName || config.get<string>('defaultProvider') || 'deepseek');
    const model = (typeof modelName === 'object' && modelName !== null
      ? (modelName as any).name : modelName)
      || config.get<string>('defaultModel') || 'deepseek-v4-pro';

    if (!provider) {
      this.postMessage({ type: 'error', text: 'Провайдер не найден.' }, sessionId);
      return;
    }

    const workspaceFolders = vscode.workspace.workspaceFolders;
    const workspacePath = workspaceFolders?.[0]?.uri.fsPath || '/tmp';

    // Создаём AbortController для возможности отмены (привязан к сессии)
    const sid = sessionId || 'default';
    const ac = new AbortController();
    this.abortControllers.set(sid, ac);
    const signal = ac.signal;

    // Записываем запуск в историю со статусом 'running'
    const implRunId = generateRunId();
    const implStartTime = Date.now();
    this.recordRunStart(implRunId, implStartTime, 'Имплементация плана', 'plan-mode', model, 'agent', sessionId);

    this.postMessage({ type: 'implementStarted' }, sessionId);
    this.postMessage({ type: 'streamChunk', text: '🚀 **Имплементирую план...**\n' }, sessionId);

    const planManager = new PlanModeManager(workspacePath, this.resolveSessionId(sessionId), (e) => this.sessionLog?.append(e));

    try {
      // Этап 2: Имплементация
      const implResult = await planManager.implementPlan(planPath, provider, model, (msg) => {
        this.debugChannel.appendLine(`[PlanMode] ${msg}`);
      }, signal);

      this.postMessage({
        type: 'streamChunk',
        text: `\n✅ Имплементация завершена (воркеров: ${implResult.orchestratorResult.workers.length})\n`,
      }, sessionId);

      // Сохраняем результат имплементации в историю сессии
      this.conversationManager.addMessageTo(sessionId, { role: 'assistant', content: `✅ Имплементация завершена (воркеров: ${implResult.orchestratorResult.workers.length})` });

      // Этап 3: Рефлексия
      this.postMessage({ type: 'streamChunk', text: '🔍 **Рефлексия...**\n' }, sessionId);

      const reflectResult = await planManager.reflect(planPath, provider, model, 2, (cycle, report) => {
        this.debugChannel.appendLine(`[PlanMode] Рефлексия цикл ${cycle}: ${report.slice(0, 200)}`);
        // Показываем прогресс циклов в чате
        const hasFailures = /(?:AC-\d+\s*❌|❌\s*AC-)/.test(report);
        const isFallback = /исчерпан лимит итераций/.test(report);
        if (hasFailures && cycle < 2) {
          this.postMessage({ type: 'streamChunk', text: `\n🔄 **Цикл ${cycle}:** найдены замечания, запускаю исправление...\n` }, sessionId);
        } else if (isFallback) {
          this.postMessage({ type: 'streamChunk', text: `\n⚠️ **Цикл ${cycle}:** ревьюер не справился, пробую ещё раз...\n` }, sessionId);
        }
      }, signal);

      // Финализируем стрим ПЕРЕД показом отчёта: showReflectReport вызывает addMessage(),
      // который сбрасывает ссылки на стрим-элемент — иначе «Имплементирую план…» не завершится.
      this.postMessage({ type: 'done' }, sessionId);

      this.postMessage({
        type: 'reflectReport',
        report: reflectResult.report,
        allPassed: reflectResult.allPassed,
      }, sessionId);

      // Сохраняем отчёт рефлексии в историю сессии
      const reportPrefix = reflectResult.allPassed ? '🎉 **Рефлексия пройдена:**' : '⚠️ **Рефлексия — есть замечания:**';
      this.conversationManager.addMessageTo(sessionId, { role: 'assistant', content: `${reportPrefix}\n\n${reflectResult.report}` });

      this.finalizeRun(implRunId, implStartTime, model, 'plan-mode', 0, 0, 1, 'success');
    } catch (err: any) {
      if (isAbortError(err)) {
        this.markCancelled(sessionId);
        this.finalizeRun(implRunId, implStartTime, model, 'plan-mode', 0, 0, 0, 'cancelled');
      } else {
        this.postMessage({ type: 'error', text: `Ошибка имплементации: ${err.message}` }, sessionId);
        this.finalizeRun(implRunId, implStartTime, model, 'plan-mode', 0, 0, 0, 'error', err.message);
      }
    }
  }

  /** Запустить multi-agent оркестрацию по команде @orchestrate */
  private async handleOrchestrate(taskText: string, provider: any, model: string, sessionId?: string): Promise<void> {
    const orchestratorView = this.orchestratorViewProvider;
    if (!orchestratorView) {
      this.postMessage({ type: 'error', text: 'Оркестратор не доступен' }, sessionId);
      return;
    }

    // Записываем запуск в историю со статусом 'running'
    const orchRunId = `orch_${Date.now()}`;
    const orchStartTime = Date.now();
    this.recordRunStart(orchRunId, orchStartTime, taskText, 'orchestrator', model, 'agent', sessionId);

    // AbortController для отмены (привязан к сессии) — кнопка ⏹️
    const sid = sessionId || 'default';
    const ac = new AbortController();
    this.abortControllers.set(sid, ac);
    const signal = ac.signal;
    console.warn(`[LLM Assistant] orchestrator: sid=${sid.slice(0, 16)}, контроллер создан, всего=${this.abortControllers.size}`);

    // Пишем user-сообщение в лог сразу — иначе при переключении чата список пуст, пока процесс идёт
    this.conversationManager.addMessageTo(sessionId, { role: 'user', content: `@orchestrate ${taskText}` });

    // Загружаем роли из .llma/agents/*.md (динамически) или fallback
    const roles = loadOrchestratorRoles();

    const task: MultiAgentTask = {
      id: orchRunId,
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

    this.postMessage({ type: 'streamChunk', text: `🎭 **Оркестратор запущен** (${roles.length} воркеров: ${roles.map(r => r.name).join(' → ')})\n\n` }, sessionId);

    // --- Загрузка MCP-инструментов для оркестратора ---
    const mcpTools: any[] = [];
    const config = vscode.workspace.getConfiguration('llmAssistant');
    try {
      const mcpConfigs = loadMcpConfig();
      if (mcpConfigs.length > 0) {
        for (const cfg of mcpConfigs) {
          try {
            const client = new McpClient(cfg);
            const result = await client.connect();
            const rawMcpTools = result.tools.map((t: any) => ({
              type: 'function', function: { name: t.name, description: t.description, parameters: t.parameters }
            }));
            mcpTools.push(...rawMcpTools);
            this.debugChannel.appendLine(`[Orchestrator] MCP connected: ${cfg.name} (${rawMcpTools.length} tools)`);
          } catch (err: any) {
            this.debugChannel.appendLine(`[WARN] MCP ${cfg.name}: ${err.message}`);
          }
        }
      }
    } catch (err: any) {
      this.debugChannel.appendLine(`[WARN] MCP config error: ${err.message}`);
    }

    const orchestrator = new AgentOrchestrator(
      (msg) => { this.debugChannel.appendLine(`[Orchestrator] ${msg}`); },
      // onWorkerStart — стримим в чат: «🔄 architect работает...»
      (roleName) => {
        this.postMessage({ type: 'streamChunk', text: `\n🔄 **${roleName}** работает...\n` }, sessionId);
        orchestratorView.updateWorker(roleName, { status: 'running' });
      },
      // onWorkerDone — стримим: «✅ architect» или «❌ architect»
      (roleName, error) => {
        const status = error ? 'error' : 'done';
        orchestratorView.updateWorker(roleName, { status });
        if (error) {
          this.postMessage({ type: 'streamChunk', text: `❌ **${roleName}**: ${error}\n` }, sessionId);
        }
      },
      // Воркеры оркестратора: лимит 20 итераций + пишут tool-события в session-log (F1 5a)
      {
        signal,
        maxIterations: 20,
        sessionId: this.resolveSessionId(sessionId === 'default' ? undefined : sessionId),
        onEvent: (e) => this.sessionLog?.append(e),
      },
    );

    // Отмечаем воркеров как running
    for (const role of roles) {
      orchestratorView.updateWorker(role.name, { status: 'pending' });
    }

    let result: MultiAgentResult;
    try {
      result = await orchestrator.execute(task, provider, mcpTools.length > 0 ? mcpTools : undefined);
    } catch (err: any) {
      if (isAbortError(err)) {
        this.markCancelled(sessionId);
        this.finalizeRun(orchRunId, orchStartTime, model, 'orchestrator', 0, 0, 0, 'cancelled');
        return;
      }
      throw err;
    }

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

      const wtStatus = wt.error ? ' ❌' : (wt.result.limitExceeded ? ' ⚠️' : ' ✅');
      const wtBody = wt.error ? `Ошибка: ${wt.error}` : wt.result.answer;
      this.postMessage({
        type: 'streamChunk',
        text: `\n### ${wt.roleName}${wtStatus}\n${wtBody}\n`,
      }, sessionId);
    }

    this.postMessage({ type: 'streamChunk', text: `\n---\n🎭 **Оркестрация завершена.** Токенов: ${result.totalInputTokens}+${result.totalOutputTokens} | Стоимость: $${result.totalCost.toFixed(6)}\n` }, sessionId);
    this.postMessage({ type: 'done' }, sessionId);

    // Токены оркестратора в индикатор
    this.postMessage({ type: 'tokens', inputTokens: result.totalInputTokens, outputTokens: result.totalOutputTokens, model, maxTokens: this.getMaxContextTokens() }, sessionId);

    // Сохраняем ответ в историю (user-сообщение уже записано в начале оркестрации)
    this.conversationManager.addMessageTo(sessionId, { role: 'assistant', content: result.summary });

    // Обновляем запись в истории запусков финальным статусом
    this.finalizeRun(
      orchRunId,
      orchStartTime,
      model,
      'orchestrator',
      result.totalInputTokens,
      result.totalOutputTokens,
      result.workers.reduce((s, w) => s + w.result.iterations, 0),
      result.workers.some((w) => w.error) ? 'error' : result.workers.some((w) => w.result?.limitExceeded) ? 'limit_exceeded' : 'success',
    );
  }

  /** Запросить подтверждение у пользователя для опасной операции */
  private async requestConfirmation(toolName: string, args: Record<string, unknown>): Promise<boolean> {
    // Для write_file читаем текущее содержимое файла (если есть) — для git-дифа в диалоге
    let oldContent = '';
    if (toolName === 'write_file' && args.path) {
      try {
        const root = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
        const p = args.path as string;
        const filePath = root ? (path.isAbsolute(p) ? p : path.join(root, p)) : p;
        if (fs.existsSync(filePath)) {
          oldContent = fs.readFileSync(filePath, 'utf-8');
        }
      } catch { /* файла нет — новый, oldContent остаётся пустым */ }
    }
    return new Promise((resolve) => {
      const requestId = `confirm_${Date.now()}`;
      this.postMessage({
        type: 'confirmAction',
        requestId,
        toolName,
        filePath: args.path || '',
        content: (args.content as string) || (args.command as string) || '',
        oldContent,
        oldStr: args.old_str || '',
        newStr: args.new_str || '',
      });

      // Временно подписываемся на ответ
      const disposable = this.view?.webview.onDidReceiveMessage((m: any) => {
        if (m.type === 'confirmResponse' && m.requestId === requestId) {
          disposable?.dispose();
          resolve(m.approved === true);
        }
      });
    });
  }

  /** Максимальный размер контекста из настроек (для индикатора токенов). */
  private getMaxContextTokens(): number {
    return vscode.workspace.getConfiguration('llmAssistant').get<number>('chat.maxContextTokens', 4096);
  }

  private postTokens(messages: any[], fullResponse: string, model: string): void {
    const inTokens = Math.ceil(messages.reduce((s: number, m: any) => s + (typeof m.content === 'string' ? m.content.length : JSON.stringify(m.content).length), 0) / 4);
    const outTokens = Math.ceil(fullResponse.length / 4);
    this.postMessage({ type: 'tokens', inputTokens: inTokens, outputTokens: outTokens, model, maxTokens: this.getMaxContextTokens() });
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
          'Ты — AI-агент в VS Code. ТВОЯ ГЛАВНАЯ ЗАДАЧА — использовать инструменты, а не писать текст.\n' +
          'Инструменты: read_file, write_file, replace_in_file, list_files, search_files, run_terminal, web_fetch, ask_user, delegate_to_agent.\n' +
          'ПРАВИЛО: если пользователь говорит «спроси», «уточни», «предложи варианты», «задай вопрос», «выясни» — ОБЯЗАТЕЛЬНО вызови инструмент ask_user. ' +
          'НЕ отвечай текстом на такие запросы — ВЫЗЫВАЙ ИНСТРУМЕНТ! ' +
          'ПРАВИЛО: если пользователь просит прочитать страницу/URL — вызови web_fetch.\n' +
          'НЕ ОТВЕЧАЙ текстом там, где нужно вызвать инструмент. НЕ задавай уточняющих вопросов без явной просьбы пользователя. НЕ спрашивай «что дальше?» после выполнения задачи — просто заверши. Если задача понятна — выполняй. Отвечай кратко, по-русски.';
      } else {
        prompt = config.get<string>('chat.systemPrompt') ||
          'Ты — AI-ассистент в VS Code. Отвечай кратко, по-русски, по делу. Без воды. Формат: markdown.';
      }
    } else if (mode === 'agent') {
      prompt = config.get<string>('chat.agentSystemPrompt') ||
        'Ты — AI-агент в VS Code. ТВОЯ ГЛАВНАЯ ЗАДАЧА — использовать инструменты, а не писать текст.\n' +
        'Инструменты: read_file, write_file, replace_in_file, list_files, search_files, run_terminal, web_fetch, ask_user, delegate_to_agent.\n' +
        'ПРАВИЛО: если пользователь просит «спроси у меня», «уточни», «предложи варианты» — ОБЯЗАТЕЛЬНО вызови ask_user (с options или без).\n' +
        'ПРАВИЛО: если пользователь просит прочитать страницу/URL — вызови web_fetch.\n' +
        'НЕ ОТВЕЧАЙ текстом там, где нужно вызвать инструмент. Отвечай кратко, по-русски.';
    } else {
      prompt = config.get<string>('chat.systemPrompt') ||
        'Ты — AI-ассистент в VS Code. Отвечай кратко, по-русски, по делу. Без воды. Формат: markdown.';
    }

    // Автоинжект AGENTS.md (слой 01 System Policy)
    const agentsMd = await loadAgentsMd();
    if (agentsMd) {
      prompt += `\n\n## Правила проекта (AGENTS.md):\n${agentsMd}`;
    }

    // Автоинжект каталога скилов (SC-1: агент видит доступные скилы)
    if (mode === 'agent') {
      const workspaceFolder = vscode.workspace.workspaceFolders?.[0];
      if (workspaceFolder) {
        const skillCatalog = getSkillTemplate(workspaceFolder.uri.fsPath);
        // Добавляем только если есть доступные скилы (getSkillTemplate всегда возвращает базовый шаблон)
        prompt += `\n\n${skillCatalog}`;
      }
    }

    const debug = vscode.workspace.getConfiguration('llmAssistant').get<boolean>('debug', false);
    if (debug) {
      this.debugChannel.appendLine(`[DEBUG] === System Prompt (${mode} mode) ===`);
      this.debugChannel.appendLine(prompt);
      this.debugChannel.appendLine('[DEBUG] === Конец System Prompt ===');
    }

    return prompt;
  }

  private handleCancelRequest(sessionId?: string): void {
    const sid = sessionId || 'default';
    const ac = this.abortControllers.get(sid);
    console.warn(`[LLM Assistant] cancelRequest: sid=${sid.slice(0, 16)}, найден=${!!ac}, всего=${this.abortControllers.size}`);
    if (ac) { ac.abort(); this.abortControllers.delete(sid); }
  }
  private sendHistoryToWebview(): void {
    const sessionId = this.conversationManager.session.getActive()?.meta.id;
    const events = (sessionId && this.sessionLog?.getEvents(sessionId)) || [];

    // Собираем упорядоченный список для отображения: user / assistant(+steps) / trace
    const items: any[] = [];
    let pendingSteps: any[] = [];
    for (const e of events) {
      if (e.type === 'user/message') {
        items.push({ kind: 'user', content: e.content });
      } else if (e.type === 'tool/call') {
        pendingSteps.push({ stepId: e.stepId, toolName: e.name, args: e.args, result: '' });
      } else if (e.type === 'tool/result') {
        const s = pendingSteps.find((x) => x.stepId === e.stepId);
        if (s) s.result = e.result;
      } else if (e.type === 'assistant/message') {
        items.push({ kind: 'assistant', content: e.content, steps: pendingSteps });
        pendingSteps = [];
      }
    }
    // Шаги без финального ответа (отменённый/упавший ран) — отдельным трейсом
    if (pendingSteps.length) items.push({ kind: 'trace', steps: pendingSteps });

    console.warn(`[LLM Assistant] history: ${items.length} элементов, активная=${sessionId?.slice(0, 16) ?? 'нет'}`);
    if (this.view) this.postMessage({ type: 'history', messages: items });
  }

  /** Восстановить индикатор токенов (📊) из истории запусков для сессии — иначе после Reload он 0. */
  private restoreTokenIndicator(sessionId?: string): void {
    const sid = sessionId || this.conversationManager.session.getActive()?.meta.id;
    if (!sid) return;
    const last = this.runHistoryStore.getRuns().find((r) => r.sessionId === sid && r.status !== 'running');
    if (last) {
      this.postMessage({ type: 'tokens', inputTokens: last.tokensIn, outputTokens: last.tokensOut, model: last.model, maxTokens: this.getMaxContextTokens() });
    } else {
      this.postMessage({ type: 'tokens', inputTokens: 0, outputTokens: 0, model: '', maxTokens: this.getMaxContextTokens() });
    }
  }
  private sendSessionListToWebview(): void {
    if (!this.view) return;
    const sessions = this.conversationManager.session.listSessions().map(s => ({
      ...s,
      preview: this.getSessionPreview(s.id),
    }));
    this.postMessage({ type: 'sessionList', sessions, activeId: this.conversationManager.session.getActive()?.meta.id });
  }

  /** Превью сессии для сайдбара (P0 Этап 2): последнее сообщение из session-log. */
  private getSessionPreview(sessionId: string): string {
    const events = this.sessionLog?.getEvents(sessionId) ?? [];
    for (let i = events.length - 1; i >= 0; i--) {
      const e = events[i];
      if (e.type === 'user/message' || e.type === 'assistant/message') {
        const text = e.content.replace(/\s+/g, ' ').trim();
        return text.length > 80 ? text.slice(0, 80) + '…' : text;
      }
    }
    return '';
  }
  private sendProviderListToWebview(): void {
    if (!this.view) return;
    const config = vscode.workspace.getConfiguration('llmAssistant');
    const providersConfig = config.get<Record<string, any>>('providers') ?? {};
    const providers: Record<string, { models: string[] }> = {};
    for (const [name, cfg] of Object.entries(providersConfig)) providers[name] = { models: cfg.models ?? [] };
    this.postMessage({ type: 'providerList', providers, defaultProvider: config.get<string>('defaultProvider') ?? '' });
  }
  /** Отправить в WebView список команд для автокомплита (слэш + @orchestrate) */
  private sendSlashCommandsToWebview(): void {
    if (!this.view) return;
    const workspacePath = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
    const builtin = SLASH_COMMANDS.map((c) => ({ name: c.name, description: c.description, kind: 'builtin' as const, prefix: '/' as const }));
    const skills = workspacePath
      ? getSkillCatalog(workspacePath).map((s) => ({ name: s.name, description: s.description, kind: 'skill' as const, prefix: '/' as const }))
      : [];
    const orchestrate = [{ name: 'orchestrate', description: 'Оркестратор — цепочка воркеров', kind: 'builtin' as const, prefix: '@' as const }];
    this.postMessage({ type: 'slashCommands', items: [...builtin, ...skills, ...orchestrate] });
  }
  private postMessage(m: any, sessionId?: string): void {
    if (sessionId) m.sessionId = sessionId;
    if (this.view) this.view.webview.postMessage(m);
  }

  /** Уведомить WebView о старте/завершении процесса в сессии (для индикатора «в работе») */
  private broadcastRunState(sessionId: string | undefined, running: boolean): void {
    if (!sessionId) return;
    // Не тегируем sessionId (маршрутизация): используем runSessionId, чтобы WebView получил всегда
    this.postMessage({ type: running ? 'runStarted' : 'runEnded', runSessionId: sessionId });
  }

  private getHtmlForWebview(): string {
    try {
      const base = this.context.extensionUri;
      const htmlPath = vscode.Uri.joinPath(base, 'src', 'webviews', 'chat', 'index.html');
      let html = fs.readFileSync(htmlPath.fsPath, 'utf-8');
      html = html.replace('{{STYLES}}', fs.readFileSync(vscode.Uri.joinPath(base, 'src', 'webviews', 'chat', 'styles.css').fsPath, 'utf-8'));
      html = html.replace('{{MARKED_LIB}}', fs.readFileSync(vscode.Uri.joinPath(base, 'src', 'webviews', 'chat', 'marked.min.js').fsPath, 'utf-8'));
      html = html.replace('{{LINEDIFF}}', fs.readFileSync(vscode.Uri.joinPath(base, 'src', 'webviews', 'chat', 'lineDiff.js').fsPath, 'utf-8'));
      html = html.replace('{{TOOLBAR}}', fs.readFileSync(vscode.Uri.joinPath(base, 'src', 'webviews', 'chat', 'toolbar.js').fsPath, 'utf-8'));
      html = html.replace('{{TOOLACTIVITY}}', fs.readFileSync(vscode.Uri.joinPath(base, 'src', 'webviews', 'chat', 'toolActivity.js').fsPath, 'utf-8'));
      html = html.replace('{{SCRIPT}}', fs.readFileSync(vscode.Uri.joinPath(base, 'src', 'webviews', 'chat', 'main.js').fsPath, 'utf-8'));
      return html;
    } catch { return '<html><body><h1>Ошибка загрузки чата</h1></body></html>'; }
  }
}
