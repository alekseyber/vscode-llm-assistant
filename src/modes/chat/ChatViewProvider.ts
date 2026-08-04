// ChatViewProvider — WebviewViewProvider для боковой панели чата

import * as vscode from 'vscode';
import * as fs from 'fs';
import OpenAI from 'openai';
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

  constructor(ctx: vscode.ExtensionContext, pm: ProviderManager, cm: ConversationManager) {
    this.context = ctx;
    this.providerManager = pm;
    this.conversationManager = cm;
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
    }
  }

  private async handleSendMessage(text: string, mode = 'chat', providerName?: string, modelName?: string): Promise<void> {
    this.conversationManager.addMessage({ role: 'user', content: text });

    const config = vscode.workspace.getConfiguration('llmAssistant');
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
      const systemPrompt = this.getSystemPrompt(mode);
      const messages: any[] = [
        { role: 'system', content: systemPrompt },
        ...this.conversationManager.getMessagesForHistory(),
      ];

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

    for (let i = 0; i < MAX_ITER; i++) {
      if (this.abortController?.signal.aborted) break;

      // Используем прямой вызов OpenAI SDK для function calling
      const client = new OpenAI({
        apiKey: (provider as any).apiKey || 'dummy',
        baseURL: (provider as any).baseUrl,
      });

      const response = await client.chat.completions.create({
        model,
        messages,
        tools: tools as any,
        tool_choice: 'auto',
      }, { signal: this.abortController?.signal });

      const choice = response.choices[0];
      const toolCalls = choice.message.tool_calls;

      if (!toolCalls || toolCalls.length === 0) {
        // Нет вызовов инструментов — обычный ответ
        const content = choice.message.content || '';
        this.postMessage({ type: 'done', text: content });
        // Стримим как один чанк (для простоты)
        this.postMessage({ type: 'streamChunk', text: content });
        this.postMessage({ type: 'done' });
        this.conversationManager.addMessage({ role: 'assistant', content });
        return;
      }

      // Выполняем инструменты
      messages.push(choice.message);
      for (const tc of toolCalls) {
        const tool = getTool(tc.function.name);
        let result: string;
        if (tool) {
          try {
            const args = JSON.parse(tc.function.arguments);
            result = await tool.execute(args);
            this.postMessage({ type: 'streamChunk', text: `\n🔧 **${tc.function.name}**\n` });
          } catch (e: any) {
            result = `Ошибка: ${e.message}`;
          }
        } else {
          result = `Инструмент '${tc.function.name}' не найден`;
        }
        messages.push({ role: 'tool', tool_call_id: tc.id, content: result });
        this.postMessage({ type: 'streamChunk', text: result + '\n' });
      }
    }
    // Если исчерпали итерации
    this.postMessage({ type: 'done' });
  }

  private getSystemPrompt(mode: string): string {
    const config = vscode.workspace.getConfiguration('llmAssistant');
    if (mode === 'agent') {
      return config.get<string>('chat.agentSystemPrompt') ||
        'Ты — AI-агент в VS Code. У тебя есть доступ к файлам: read_file, write_file, replace_in_file. ' +
        'Используй их когда нужно прочитать код или внести изменения. ' +
        'Отвечай кратко, по-русски, по делу. После изменений в файлах — сообщи результат.';
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
