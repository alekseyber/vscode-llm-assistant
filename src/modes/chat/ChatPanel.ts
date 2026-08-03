// ChatPanel — управление WebviewPanel для чата (отдельная вкладка)
// Создаёт, показывает, скрывает и удаляет WebviewPanel.
// Маршрутизирует postMessage между WebView и Extension (ProviderManager).

import * as vscode from 'vscode';
import * as fs from 'fs';
import { ProviderManager } from '../../providers/manager';
import { ConversationManager } from './ConversationManager';
import { ChatMessage } from '../../providers/types';

/**
 * ChatPanel — управляет отдельной вкладкой (WebviewPanel) для чата с LLM.
 *
 * В отличие от ChatViewProvider (боковая панель), этот класс создаёт
 * полноценную вкладку в редакторе. Используется для команды llmAssistant.chat.focus.
 *
 * Жизненный цикл:
 * 1. createOrShow() — создать панель или показать существующую
 * 2. Панель загружает HTML через getHtmlForWebview()
 * 3. postMessage — обмен сообщениями между WebView и Extension
 * 4. При закрытии панель удаляется из реестра
 */
export class ChatPanel {
  /** Текущий инстанс панели (singleton) */
  public static currentPanel: ChatPanel | undefined;

  /** Ссылка на WebviewPanel VS Code */
  private readonly panel: vscode.WebviewPanel;

  /** Контекст расширения (нужен для URI ресурсов) */
  private readonly context: vscode.ExtensionContext;

  /** Менеджер провайдеров для отправки запросов к LLM */
  private readonly providerManager: ProviderManager;

  /** Менеджер истории сообщений */
  private readonly conversationManager: ConversationManager;

  /** AbortController для отмены текущего запроса */
  private abortController: AbortController | null = null;

  /**
   * Создать новый инстанс ChatPanel или показать существующий.
   *
   * @param context - контекст расширения
   * @param providerManager - менеджер провайдеров
   * @param conversationManager - менеджер истории
   */
  public static createOrShow(
    context: vscode.ExtensionContext,
    providerManager: ProviderManager,
    conversationManager: ConversationManager
  ): ChatPanel {
    const column = vscode.window.activeTextEditor
      ? vscode.window.activeTextEditor.viewColumn
      : undefined;

    // Если панель уже существует — показываем её
    if (ChatPanel.currentPanel) {
      ChatPanel.currentPanel.panel.reveal(column);
      return ChatPanel.currentPanel;
    }

    // Создаём новую панель
    const panel = vscode.window.createWebviewPanel(
      'llmAssistant.chatPanel', // идентификатор
      'LLM Assistant — Чат',    // заголовок
      column || vscode.ViewColumn.One,
      {
        enableScripts: true,
        retainContextWhenHidden: true,
        localResourceRoots: [
          vscode.Uri.joinPath(context.extensionUri, 'src', 'webviews', 'chat'),
          vscode.Uri.joinPath(context.extensionUri, 'node_modules'),
        ],
      }
    );

    const chatPanel = new ChatPanel(panel, context, providerManager, conversationManager);
    ChatPanel.currentPanel = chatPanel;
    return chatPanel;
  }

  /**
   * Приватный конструктор. Используйте createOrShow().
   */
  private constructor(
    panel: vscode.WebviewPanel,
    context: vscode.ExtensionContext,
    providerManager: ProviderManager,
    conversationManager: ConversationManager
  ) {
    this.panel = panel;
    this.context = context;
    this.providerManager = providerManager;
    this.conversationManager = conversationManager;

    // Устанавливаем HTML-содержимое панели
    this.panel.webview.html = this.getHtmlForWebview();

    // Подписываемся на сообщения из WebView
    this.panel.webview.onDidReceiveMessage(
      (message) => this.handleWebviewMessage(message),
      undefined,
      context.subscriptions
    );

    // При закрытии панели очищаем ссылку
    this.panel.onDidDispose(
      () => {
        ChatPanel.currentPanel = undefined;
      },
      undefined,
      context.subscriptions
    );
  }

  /**
   * Обработать сообщение от WebView (фронтенда).
   *
   * @param message - сообщение от WebView { type, text, ... }
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
        // WebView сообщает, что он загружен — отправляем историю
        this.sendHistoryToWebview();
        break;

      default:
        console.warn('[ChatPanel] Неизвестный тип сообщения:', message.type);
    }
  }

  /**
   * Отправить сообщение пользователя в LLM и стримить ответ в WebView.
   *
   * @param text - текст сообщения пользователя
   */
  private async handleSendMessage(text: string): Promise<void> {
    // Сохраняем сообщение пользователя в историю
    this.conversationManager.addMessage({ role: 'user', content: text });

    // Уведомляем WebView о новом сообщении пользователя
    this.postMessage({ type: 'userMessage', text });

    // Получаем провайдера по умолчанию
    const provider = this.providerManager.getDefault();
    if (!provider) {
      this.postMessage({
        type: 'error',
        text: 'Провайдер не настроен. Проверьте настройки llmAssistant.providers.',
      });
      return;
    }

    // Получаем конфиг для модели по умолчанию
    const config = vscode.workspace.getConfiguration('llmAssistant');
    const model = config.get<string>('defaultModel') ?? 'gpt-4o';

    // Создаём AbortController для возможности отмены
    this.abortController = new AbortController();

    try {
      // Отправляем всю историю в LLM
      const messages: ChatMessage[] = this.conversationManager.getMessages();
      const stream = provider.chat(
        messages,
        { model, stream: true },
        this.abortController.signal
      );

      let fullResponse = '';

      // Стримим токены в WebView по мере поступления
      for await (const chunk of stream) {
        fullResponse += chunk;
        this.postMessage({ type: 'streamChunk', text: chunk });
      }

      // Сообщаем о завершении стрима
      this.postMessage({ type: 'done' });

      // Сохраняем ответ ассистента в историю
      this.conversationManager.addMessage({ role: 'assistant', content: fullResponse });
    } catch (error: any) {
      if (error.name === 'AbortError') {
        this.postMessage({ type: 'cancelled' });
      } else {
        const errorMessage = error.message || 'Неизвестная ошибка';
        this.postMessage({ type: 'error', text: `Ошибка: ${errorMessage}` });
        console.error('[ChatPanel] Ошибка запроса к LLM:', error);
      }
    } finally {
      this.abortController = null;
    }
  }

  /**
   * Отменить текущий запрос к LLM.
   */
  private handleCancelRequest(): void {
    if (this.abortController) {
      this.abortController.abort();
      this.abortController = null;
    }
  }

  /**
   * Отправить всю историю сообщений в WebView.
   * Вызывается при загрузке WebView.
   */
  private sendHistoryToWebview(): void {
    const messages = this.conversationManager.getMessages();
    this.postMessage({ type: 'history', messages });
  }

  /**
   * Отправить сообщение в WebView.
   *
   * @param message - объект сообщения (будет сериализован в JSON)
   */
  private postMessage(message: any): void {
    this.panel.webview.postMessage(message);
  }

  /**
   * Сгенерировать HTML для WebView.
   * Читает index.html, styles.css, main.js и marked.min.js,
   * затем собирает всё в один HTML-файл с инлайновыми стилями и скриптами.
   */
  private getHtmlForWebview(): string {
    try {
      // Пути к ресурсам
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

      // Читаем файлы
      let html = fs.readFileSync(htmlPath.fsPath, 'utf-8');
      const styles = fs.readFileSync(stylesPath.fsPath, 'utf-8');
      const markedSrc = fs.readFileSync(markedPath.fsPath, 'utf-8');
      const mainJs = fs.readFileSync(mainJsPath.fsPath, 'utf-8');

      // Собираем финальный HTML с инлайновыми стилями и скриптами
      html = html.replace('{{STYLES}}', styles);
      html = html.replace('{{MARKED_LIB}}', markedSrc);
      html = html.replace('{{SCRIPT}}', mainJs);

      return html;
    } catch (error) {
      console.error('[ChatPanel] Ошибка чтения файлов WebView:', error);
      return '<html><body><h1>Ошибка загрузки чата</h1><p>Не удалось прочитать файлы WebView.</p></body></html>';
    }
  }

  /**
   * Освободить ресурсы при деактивации расширения.
   */
  public dispose(): void {
    if (this.panel) {
      this.panel.dispose();
    }
    ChatPanel.currentPanel = undefined;
  }
}