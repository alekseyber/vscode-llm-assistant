// ChatViewProvider — WebviewViewProvider для боковой панели чата

import * as vscode from 'vscode';
import * as fs from 'fs';
import { ProviderManager } from '../../providers/manager';
import { ConversationManager } from './ConversationManager';
import { ChatMessage } from '../../providers/types';
import { getToolSchemas, getTool } from './ChatAgentTools';

export class ChatViewProvider implements vscode.WebviewViewProvider {
  public static readonly viewType = 'llmAssistant.chat';
  private view?: vscode.WebviewView;
  private readonly context: vscode.ExtensionContext;
  private readonly providerManager: ProviderManager;
  private readonly conversationManager: ConversationManager;
  private abortController: AbortController | null = null;
  private pendingImage: { fileName: string; base64: string; mimeType: string } | null = null;

  constructor(ctx: vscode.ExtensionContext, pm: ProviderManager, cm: ConversationManager) {
    this.context = ctx;
    this.providerManager = pm;
    this.conversationManager = cm;
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

    // Не добавляем в историю сразу если будет vision (изображение добавится вместе с текстом)
    if (!isVision) {
      this.conversationManager.addMessage({ role: 'user', content: text });
    }

    // Авто-контекст
    if (mode === 'agent' || config.get<boolean>('chat.includeOpenFile', true)) {
      const editor = vscode.window.activeTextEditor;
      if (editor) {
        this.conversationManager.attachCodeContext({
          filePath: editor.document.fileName,
          content: editor.document.getText(),
        });
      }
    }

    this.postMessage({ type: 'userMessage', text });

    const provider = providerName ? this.providerManager.getProvider(providerName) : this.providerManager.getDefault();
    if (!provider) { this.postMessage({ type: 'error', text: 'Провайдер не настроен.' }); return; }

    const model = modelName || config.get<string>('defaultModel') || 'gpt-4o';
    this.abortController = new AbortController();

    try {
      const systemPrompt = this.getSystemPrompt(mode, providerName);
      const messages: any[] = [
        { role: 'system', content: systemPrompt },
        ...this.conversationManager.getMessagesForHistory(),
      ];

      // Vision: добавляем одно сообщение с текстом + изображением
      const openaiProvider = provider as any;
      if (isVision && openaiProvider.supportsVision) {
        const userMsg: any = { role: 'user', content: [
          { type: 'text', text },
          { type: 'image_url', image_url: { url: `data:${this.pendingImage!.mimeType};base64,${this.pendingImage!.base64}` } }
        ]};
        messages.push(userMsg);
        this.pendingImage = null;

        const stream = openaiProvider.chatWithVision(messages, { model, stream: true }, this.abortController.signal);
        let full = '';
        for await (const chunk of stream) { full += chunk; this.postMessage({ type: 'streamChunk', text: chunk }); }
        this.postMessage({ type: 'done' });
        // Сохраняем в историю после успешного ответа
        this.conversationManager.addMessage({ role: 'user', content: text });
        this.conversationManager.addMessage({ role: 'assistant', content: full });
        return;
      }

      this.pendingImage = null;

      if (mode === 'agent') {
        await this.runAgentLoop(provider, model, messages);
      } else {
        const stream = provider.chat(messages, { model, stream: true }, this.abortController.signal);
        let full = '';
        for await (const chunk of stream) { full += chunk; this.postMessage({ type: 'streamChunk', text: chunk }); }
        this.postMessage({ type: 'done' });
        this.conversationManager.addMessage({ role: 'assistant', content: full });
      }
    } catch (error: any) {
      if (error.name === 'AbortError') this.postMessage({ type: 'cancelled' });
      else { this.postMessage({ type: 'error', text: `Ошибка: ${error.message}` }); console.error('[ChatViewProvider]', error); }
    } finally { this.abortController = null; }
  }

  /** ReAct-цикл с инструментами (только для агентного режима) */
  private async runAgentLoop(provider: any, model: string, messages: any[]): Promise<void> {
    const MAX_ITER = 5;
    const tools = getToolSchemas();
    const config = vscode.workspace.getConfiguration('llmAssistant');
    const requireConfirmation = config.get<boolean>('agent.requireConfirmation', true);

    for (let i = 0; i < MAX_ITER; i++) {
      if (this.abortController?.signal.aborted) break;

      const response = await (provider as any).createWithTools(messages, model, tools, this.abortController?.signal);

      const choice = response.choices[0];
      const toolCalls = choice.message.tool_calls;

      if (!toolCalls || toolCalls.length === 0) {
        const content = choice.message.content || '';
        this.postMessage({ type: 'streamChunk', text: content });
        this.postMessage({ type: 'done' });
        this.conversationManager.addMessage({ role: 'assistant', content });
        return;
      }

      // Выполняем инструменты с подтверждением для опасных операций
      messages.push(choice.message);
      for (const tc of toolCalls) {
        const tool = getTool(tc.function.name);
        if (!tool) {
          messages.push({ role: 'tool', tool_call_id: tc.id, content: `Инструмент '${tc.function.name}' не найден` });
          continue;
        }

        const args = JSON.parse(tc.function.arguments);
        const isDangerous = tc.function.name === 'write_file' || tc.function.name === 'replace_in_file';

        // Запрос подтверждения для опасных операций
        if (isDangerous && requireConfirmation) {
          const approved = await this.requestConfirmation(tc.function.name, args);
          if (!approved) {
            messages.push({ role: 'tool', tool_call_id: tc.id, content: 'Операция отклонена пользователем.' });
            this.postMessage({ type: 'streamChunk', text: '❌ Отклонено\n' });
            continue;
          }
        }

        this.postMessage({ type: 'streamChunk', text: `\n🔧 **${tc.function.name}**\n` });
        try {
          const result = await tool.execute(args);
          messages.push({ role: 'tool', tool_call_id: tc.id, content: result });
          this.postMessage({ type: 'streamChunk', text: result + '\n' });
        } catch (e: any) {
          messages.push({ role: 'tool', tool_call_id: tc.id, content: `Ошибка: ${e.message}` });
        }
      }
    }
    this.postMessage({ type: 'done' });
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

  private getSystemPrompt(mode: string, providerName?: string): string {
    const config = vscode.workspace.getConfiguration('llmAssistant');
    // Кастомный промпт провайдера (если указан в settings)
    if (providerName) {
      const providersCfg = config.get<Record<string, any>>('providers') ?? {};
      const providerCfg = providersCfg[providerName] ?? {};
      if (providerCfg.systemPrompt) return providerCfg.systemPrompt;
    }
    if (mode === 'agent') {
      return config.get<string>('chat.agentSystemPrompt') ||
        'Ты — AI-агент в VS Code. Инструменты: list_files, search_files, read_file, write_file, replace_in_file. Отвечай кратко, по-русски.';
    }
    return config.get<string>('chat.systemPrompt') ||
      'Ты — AI-ассистент в VS Code. Отвечай кратко, по-русски, по делу. Без воды. Формат: markdown.';
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
