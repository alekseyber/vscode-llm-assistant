// ChatViewProvider — WebviewViewProvider для боковой панели чата
// Регистрируется через vscode.window.registerWebviewViewProvider
// Обеспечивает двустороннюю связь между WebView (фронтенд) и Extension (бэкенд)

import * as vscode from 'vscode';
import * as fs from 'fs';
import { ProviderManager } from '../../providers/manager';
import { ConversationManager } from './ConversationManager';
import { ChatMessage } from '../../providers/types';

/**
 * ChatViewProvider — провайдер для боковой панели чата (WebviewView).
 *
 * VS Code вызывает resolveWebviewView(), когда пользователь открывает
 * панель "Чат" в боковой панели (Activity Bar → LLM Assistant).
 *
 * Особенности:
 * - Использует ConversationManager для хранения истории
 * - Отправляет сообщения в LLM через ProviderManager
 * - Стримит ответы в WebView через postMessage
 * - Поддерживает отмену запроса
 */
export class ChatViewProvider implements vscode.WebviewViewProvider {
  /** Идентификатор провайдера (должен совпадать с package.json views) */
  public static readonly viewType = 'llmAssistant.chat';

  /** Ссылка на WebviewView */
  private view?: vscode.WebviewView;

  /** Контекст расширения */
  private readonly context: vscode.ExtensionContext;

  /** Менеджер провайдеров */
  private readonly providerManager: ProviderManager;

  /** Менеджер истории сообщений */
  private readonly conversationManager: ConversationManager;

  /** AbortController для отмены текущего запроса */
  private abortController: AbortController | null = null;

  /**
   * @param context - контекст расширения
   * @param providerManager - менеджер провайдеров
   * @param conversationManager - менеджер истории
   */
  constructor(
    context: vscode.ExtensionContext,
    providerManager: ProviderManager,
    conversationManager: ConversationManager
  ) {
    this.context = context;
    this.providerManager = providerManager;
    this.conversationManager = conversationManager;
  }

  /**
   * Вызывается VS Code, когда нужно создать или показать WebView.
   * Это может произойти:
   * - При открытии боковой панели в первый раз
   * - При переключении вкладок
   * - При изменении конфигурации
   *
   * @param webviewView - представление WebView, которое нужно настроить
   */
  resolveWebviewView(
    webviewView: vscode.WebviewView,
    _context: vscode.WebviewViewResolveContext,
    _token: vscode.CancellationToken
  ): void {
    this.view = webviewView;

    // Настройка WebView
    webviewView.webview.options = {
      enableScripts: true,
      localResourceRoots: [
        vscode.Uri.joinPath(this.context.extensionUri, 'src', 'webviews', 'chat'),
        vscode.Uri.joinPath(this.context.extensionUri, 'node_modules'),
      ],
    };

    // Устанавливаем HTML-содержимое
    webviewView.webview.html = this.getHtmlForWebview();

    // Подписываемся на сообщения от WebView
    webviewView.webview.onDidReceiveMessage(
      (message) => this.handleWebviewMessage(message)
    );

    // Когда представление становится видимым, отправляем историю
    webviewView.onDidChangeVisibility(() => {
      if (webviewView.visible) {
        this.sendHistoryToWebview();
      }
    });
  }

  /**
   * Обработать сообщение от WebView.
   *
   * @param message - сообщение { type: string, ... }
   */
  private async handleWebviewMessage(message: any): Promise<void> {
    switch (message.type) {
      case 'sendMessage':
        await this.handleSendMessage(message.text);
        break;

      case 'cancelRequest':
        this.handleCancelRequest();
        break;

      case 'clearHistory':
        this.conversationManager.clearHistory();
        break;

      case 'ready':
        this.sendHistoryToWebview();
        break;

      default:
        console.warn('[ChatViewProvider] Неизвестный тип сообщения:', message.type);
    }
  }

  /**
   * Отправить сообщение пользователя в LLM и стримить ответ.
   *
   * @param text - текст сообщения
   */
  private async handleSendMessage(text: string): Promise<void> {
    // Сохраняем в историю
    this.conversationManager.addMessage({ role: 'user', content: text });

    // Показываем сообщение пользователя в WebView
    this.postMessage({ type: 'userMessage', text });

    // Получаем провайдера
    const provider = this.providerManager.getDefault();
    if (!provider) {
      this.postMessage({
        type: 'error',
        text: 'Провайдер не настроен. Проверьте настройки llmAssistant.providers.',
      });
      return;
    }

    // Получаем модель по умолчанию
    const config = vscode.workspace.getConfiguration('llmAssistant');
    const model = config.get<string>('defaultModel') ?? 'gpt-4o';

    // Создаём AbortController для отмены
    this.abortController = new AbortController();

    try {
      // Отправляем историю в LLM и получаем стрим
      const messages: ChatMessage[] = this.conversationManager.getMessages();
      const stream = provider.chat(
        messages,
        { model, stream: true },
        this.abortController.signal
      );

      let fullResponse = '';

      // Стримим токены
      for await (const chunk of stream) {
        fullResponse += chunk;
        this.postMessage({ type: 'streamChunk', text: chunk });
      }

      // Завершаем стрим
      this.postMessage({ type: 'done' });

      // Сохраняем ответ ассистента
      this.conversationManager.addMessage({ role: 'assistant', content: fullResponse });
    } catch (error: any) {
      if (error.name === 'AbortError') {
        this.postMessage({ type: 'cancelled' });
      } else {
        const errorMessage = error.message || 'Неизвестная ошибка';
        this.postMessage({ type: 'error', text: `Ошибка: ${errorMessage}` });
        console.error('[ChatViewProvider] Ошибка запроса к LLM:', error);
      }
    } finally {
      this.abortController = null;
    }
  }

  /**
   * Отменить текущий запрос.
   */
  private handleCancelRequest(): void {
    if (this.abortController) {
      this.abortController.abort();
      this.abortController = null;
    }
  }

  /**
   * Отправить историю сообщений в WebView.
   */
  private sendHistoryToWebview(): void {
    if (!this.view) return;
    const messages = this.conversationManager.getMessages();
    this.postMessage({ type: 'history', messages });
  }

  /**
   * Отправить сообщение в WebView.
   */
  private postMessage(message: any): void {
    if (this.view) {
      this.view.webview.postMessage(message);
    }
  }

  /**
   * Сгенерировать HTML для WebView.
   * Читает файлы из src/webviews/chat/ и node_modules/marked/,
   * собирает HTML с инлайновыми стилями и скриптами.
   */
  private getHtmlForWebview(): string {
    try {
      const htmlPath = vscode.Uri.joinPath(
        this.context.extensionUri, 'src', 'webviews', 'chat', 'index.html'
      );
      const stylesPath = vscode.Uri.joinPath(
        this.context.extensionUri, 'src', 'webviews', 'chat', 'styles.css'
      );
      const mainJsPath = vscode.Uri.joinPath(
        this.context.extensionUri, 'src', 'webviews', 'chat', 'main.js'
      );
      const markedPath = vscode.Uri.joinPath(
        this.context.extensionUri, 'node_modules', 'marked', 'marked.min.js'
      );

      let html = fs.readFileSync(htmlPath.fsPath, 'utf-8');
      const styles = fs.readFileSync(stylesPath.fsPath, 'utf-8');
      const markedSrc = fs.readFileSync(markedPath.fsPath, 'utf-8');
      const mainJs = fs.readFileSync(mainJsPath.fsPath, 'utf-8');

      html = html.replace('{{STYLES}}', styles);
      html = html.replace('{{MARKED_LIB}}', markedSrc);
      html = html.replace('{{SCRIPT}}', mainJs);

      return html;
    } catch (error) {
      console.error('[ChatViewProvider] Ошибка чтения файлов WebView:', error);
      return '<html><body><h1>Ошибка загрузки чата</h1></body></html>';
    }
  }
}