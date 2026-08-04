// ChatViewProvider — WebviewViewProvider для боковой панели чата

import * as vscode from 'vscode';
import * as fs from 'fs';
import { ProviderManager } from '../../providers/manager';
import { ConversationManager } from './ConversationManager';
import { ChatMessage } from '../../providers/types';

export class ChatViewProvider implements vscode.WebviewViewProvider {
  public static readonly viewType = 'llmAssistant.chat';

  private view?: vscode.WebviewView;
  private readonly context: vscode.ExtensionContext;
  private readonly providerManager: ProviderManager;
  private readonly conversationManager: ConversationManager;
  private abortController: AbortController | null = null;

  constructor(
    context: vscode.ExtensionContext,
    providerManager: ProviderManager,
    conversationManager: ConversationManager
  ) {
    this.context = context;
    this.providerManager = providerManager;
    this.conversationManager = conversationManager;
  }

  resolveWebviewView(
    webviewView: vscode.WebviewView,
    _context: vscode.WebviewViewResolveContext,
    _token: vscode.CancellationToken
  ): void {
    this.view = webviewView;
    webviewView.webview.options = {
      enableScripts: true,
      localResourceRoots: [
        vscode.Uri.joinPath(this.context.extensionUri, 'src', 'webviews', 'chat'),
        vscode.Uri.joinPath(this.context.extensionUri, 'node_modules'),
      ],
    };
    webviewView.webview.html = this.getHtmlForWebview();
    webviewView.webview.onDidReceiveMessage(
      (message) => this.handleWebviewMessage(message)
    );
    webviewView.onDidChangeVisibility(() => {
      if (webviewView.visible) {
        this.sendHistoryToWebview();
      }
    });
  }

  private async handleWebviewMessage(message: any): Promise<void> {
    switch (message.type) {
      case 'sendMessage':
        await this.handleSendMessage(message.text, message.mode, message.provider, message.model);
        break;
      case 'cancelRequest':
        this.handleCancelRequest();
        break;
      case 'clearHistory':
        this.conversationManager.clearHistory();
        this.sendSessionListToWebview();
        break;
      case 'ready':
        this.sendHistoryToWebview();
        this.sendSessionListToWebview();
        this.sendProviderListToWebview();
        break;
      case 'newSession':
        this.conversationManager.session.createSession();
        this.sendHistoryToWebview();
        this.sendSessionListToWebview();
        break;
      case 'switchSession':
        if (message.sessionId) {
          this.conversationManager.session.switchTo(message.sessionId);
          this.sendHistoryToWebview();
          this.sendSessionListToWebview();
        }
        break;
      case 'listSessions':
        this.sendSessionListToWebview();
        break;
      default:
        console.warn('[ChatViewProvider] Неизвестный тип сообщения:', message.type);
    }
  }

  private async handleSendMessage(
    text: string,
    mode: string = 'chat',
    providerName?: string,
    modelName?: string
  ): Promise<void> {
    this.conversationManager.addMessage({ role: 'user', content: text });

    // Авто-контекст: для режима чат — только чтение, для агент — полный доступ
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

    // Выбор провайдера: из UI или default
    const provider = providerName
      ? this.providerManager.getProvider(providerName)
      : this.providerManager.getDefault();
    if (!provider) {
      this.postMessage({ type: 'error', text: 'Провайдер не настроен. Проверьте настройки llmAssistant.providers.' });
      return;
    }

    const model = modelName || config.get<string>('defaultModel') || 'gpt-4o';

    this.abortController = new AbortController();

    try {
      const systemPrompt = this.getSystemPrompt(mode);
      const messages: ChatMessage[] = [
        { role: 'system', content: systemPrompt },
        ...this.conversationManager.getMessagesForHistory(),
      ];

      const stream = provider.chat(messages, { model, stream: true }, this.abortController.signal);

      let fullResponse = '';
      for await (const chunk of stream) {
        fullResponse += chunk;
        this.postMessage({ type: 'streamChunk', text: chunk });
      }
      this.postMessage({ type: 'done' });
      this.conversationManager.addMessage({ role: 'assistant', content: fullResponse });
    } catch (error: any) {
      if (error.name === 'AbortError') {
        this.postMessage({ type: 'cancelled' });
      } else {
        this.postMessage({ type: 'error', text: `Ошибка: ${error.message || 'Неизвестная ошибка'}` });
        console.error('[ChatViewProvider] Ошибка запроса к LLM:', error);
      }
    } finally {
      this.abortController = null;
    }
  }

  private getSystemPrompt(mode: string): string {
    const config = vscode.workspace.getConfiguration('llmAssistant');
    if (mode === 'agent') {
      return config.get<string>('chat.agentSystemPrompt') ||
        'Ты — AI-агент в VS Code с полным доступом к файлам и терминалу. ' +
        'Ты можешь читать, редактировать и создавать файлы, выполнять команды. ' +
        'Отвечай кратко, по-русски, по делу. Предлагай конкретные действия и исправления. Формат: markdown.';
    }
    return config.get<string>('chat.systemPrompt') ||
      'Ты — AI-ассистент в VS Code. Отвечай кратко, по-русски, по делу. ' +
      'Без воды и длинных вступлений. Ты НЕ имеешь доступа к файлам — только текст диалога. ' +
      'Формат ответа: markdown.';
  }

  private handleCancelRequest(): void {
    if (this.abortController) {
      this.abortController.abort();
      this.abortController = null;
    }
  }

  private sendHistoryToWebview(): void {
    if (!this.view) return;
    this.postMessage({ type: 'history', messages: this.conversationManager.getMessages() });
  }

  private sendSessionListToWebview(): void {
    if (!this.view) return;
    const sessions = this.conversationManager.session.listSessions();
    const activeId = this.conversationManager.session.getActive()?.meta.id;
    this.postMessage({ type: 'sessionList', sessions, activeId });
  }

  private sendProviderListToWebview(): void {
    if (!this.view) return;
    const config = vscode.workspace.getConfiguration('llmAssistant');
    const providersConfig = config.get<Record<string, any>>('providers') ?? {};
    // Отправляем только имя и модели (без apiKey!)
    const providers: Record<string, { models: string[] }> = {};
    for (const [name, cfg] of Object.entries(providersConfig)) {
      providers[name] = { models: cfg.models ?? [] };
    }
    const defaultProvider = config.get<string>('defaultProvider') ?? '';
    this.postMessage({ type: 'providerList', providers, defaultProvider });
  }

  private postMessage(message: any): void {
    if (this.view) this.view.webview.postMessage(message);
  }

  private getHtmlForWebview(): string {
    try {
      const base = this.context.extensionUri;
      const htmlPath = vscode.Uri.joinPath(base, 'src', 'webviews', 'chat', 'index.html');
      const stylesPath = vscode.Uri.joinPath(base, 'src', 'webviews', 'chat', 'styles.css');
      const mainJsPath = vscode.Uri.joinPath(base, 'src', 'webviews', 'chat', 'main.js');
      const markedPath = vscode.Uri.joinPath(base, 'src', 'webviews', 'chat', 'marked.min.js');

      let html = fs.readFileSync(htmlPath.fsPath, 'utf-8');
      html = html.replace('{{STYLES}}', fs.readFileSync(stylesPath.fsPath, 'utf-8'));
      html = html.replace('{{MARKED_LIB}}', fs.readFileSync(markedPath.fsPath, 'utf-8'));
      html = html.replace('{{SCRIPT}}', fs.readFileSync(mainJsPath.fsPath, 'utf-8'));
      return html;
    } catch (error) {
      console.error('[ChatViewProvider] Ошибка чтения файлов WebView:', error);
      return '<html><body><h1>Ошибка загрузки чата</h1></body></html>';
    }
  }
}
