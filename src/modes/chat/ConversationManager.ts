// ConversationManager — управление историей сообщений чата
// Делегирует хранение SessionManager, добавляет логику контекста и системного промпта

import * as vscode from 'vscode';
import { ChatMessage } from '../../providers/types';
import { SessionManager } from './SessionManager';

/** Контекст кода */
export interface CodeContext {
  filePath: string;
  content: string;
  selectionStart?: number;
  selectionEnd?: number;
}

/** Сообщение с опциональным контекстом */
export interface ContextMessage extends ChatMessage {
  context?: CodeContext;
}

export class ConversationManager {
  private static readonly MAX_MESSAGES = 100;
  private sessionManager: SessionManager;
  /** Контекст кода для следующего запроса */
  private pendingContext: CodeContext | null = null;

  constructor(storage: vscode.Memento) {
    this.sessionManager = new SessionManager(storage);
  }

  get session(): SessionManager {
    return this.sessionManager;
  }

  getMessages(): ContextMessage[] {
    return this.sessionManager.getMessages();
  }

  /** Сообщения для отправки в LLM: system prompt + история + контекст */
  getMessagesForRequest(): ChatMessage[] {
    const config = vscode.workspace.getConfiguration('llmAssistant');
    const maxTokens = config.get<number>('chat.maxContextTokens', 4096);
    const systemPrompt = config.get<string>('chat.systemPrompt', '');

    const systemMessage: ChatMessage = { role: 'system', content: systemPrompt };
    const history = this.buildHistoryMessages(maxTokens, this.estimateTokens(systemPrompt));
    return [systemMessage, ...history];
  }

  /** Только сообщения истории (без system prompt) — для внешнего управления */
  getMessagesForHistory(): ChatMessage[] {
    return this.buildHistoryMessages(Number.MAX_SAFE_INTEGER, 0);
  }

  private buildHistoryMessages(maxTokens: number, usedTokens: number): ChatMessage[] {
    const messages = this.sessionManager.getMessages();
    const history: ChatMessage[] = [];
    let totalTokens = usedTokens;

    for (let i = messages.length - 1; i >= 0; i--) {
      const msg = messages[i];
      const msgTokens = this.estimateTokens(msg.content);

      if (totalTokens + msgTokens > maxTokens && history.length > 0) break;

      totalTokens += msgTokens;
      // Добавляем контекст файла к пользовательским сообщениям
      const contextStr = (msg as ContextMessage).context?.content
        ? `\n\n--- Файл: ${(msg as ContextMessage).context!.filePath} ---\n\`\`\`\n${(msg as ContextMessage).context!.content}\n\`\`\``
        : '';
      history.unshift({
        role: msg.role,
        content: msg.content + contextStr,
      });
    }

    return history;
  }

  addMessage(message: ContextMessage): void {
    // Добавляем pending-контекст к пользовательским сообщениям
    if (message.role === 'user' && this.pendingContext) {
      message.context = this.pendingContext;
      this.pendingContext = null;
    }
    this.sessionManager.addMessage(message);
    // Авто-имя сессии из первого сообщения
    if (message.role === 'user') {
      this.sessionManager.autoNameSession(this.sessionManager.getActive()?.meta.id || '');
    }
  }

  clearHistory(): void {
    this.sessionManager.clearActive();
  }

  attachCodeContext(context: CodeContext): void {
    // Сохраняем как pending — прикрепится к следующему сообщению пользователя
    this.pendingContext = context;
  }

  private estimateTokens(text: string): number {
    return Math.ceil(text.length / 4);
  }
}
