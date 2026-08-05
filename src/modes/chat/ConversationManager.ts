// ConversationManager — управление историей сообщений чата
// Делегирует хранение SessionManager, добавляет логику контекста и системного промпта
// Слой 04 Context Management: summary при переполнении контекста

import * as vscode from 'vscode';
import { ChatMessage } from '../../providers/types';
import { SessionManager } from './SessionManager';
import { loadAgentsMd } from '../../shared/AgentsMdLoader';
import { ContextSummarizer } from '../../shared/ContextSummarizer';

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
  /** Суммаризатор для сжатия обрезанной истории */
  private summarizer: ContextSummarizer = new ContextSummarizer();

  constructor(storage: vscode.Memento) {
    this.sessionManager = new SessionManager(storage);
  }

  get session(): SessionManager {
    return this.sessionManager;
  }

  getMessages(): ContextMessage[] {
    return this.sessionManager.getMessages();
  }

  /** Сообщения для отправки в LLM: system prompt + AGENTS.md + [summary] + история + контекст */
  async getMessagesForRequest(provider?: import('../../providers/types').LLMProvider): Promise<ChatMessage[]> {
    const config = vscode.workspace.getConfiguration('llmAssistant');
    const maxTokens = config.get<number>('chat.maxContextTokens', 4096);
    let systemPrompt = config.get<string>('chat.systemPrompt', '');

    // Автоинжект AGENTS.md (слой 01 System Policy)
    const agentsMd = await loadAgentsMd();
    if (agentsMd) {
      systemPrompt += `\n\n## Правила проекта (AGENTS.md):\n${agentsMd}`;
    }

    const systemMessage: ChatMessage = { role: 'system', content: systemPrompt };
    let usedTokens = this.estimateTokens(systemPrompt);

    const debug = config.get<boolean>('debug', false);

    // Собираем историю с учётом лимита токенов, получаем обрезанные сообщения
    const { history, trimmed } = this.buildHistoryWithTrimmed(maxTokens, usedTokens);

    // --- Слой 04: Summary при переполнении контекста ---
    const summaryEnabled = config.get<boolean>('chat.summaryEnabled', true);
    const summaryModel = config.get<string>('chat.summaryModel', '') ||
      config.get<string>('defaultModel', '');
    const summaryTriggerTokens = config.get<number>('chat.summaryTriggerTokens', 256);

    if (debug) {
      console.warn(`[LLM Assistant] Summary check: maxTokens=${maxTokens}, usedBySystem=${usedTokens}, historyMsgs=${history.length}, trimmed=${trimmed.length}, summaryEnabled=${summaryEnabled}, hasProvider=${!!provider}, model=${summaryModel}`);
    }

    if (summaryEnabled && trimmed.length > 0 && provider) {
      // Оцениваем токены обрезанных сообщений
      const trimmedTokens = trimmed.reduce((sum, m) => sum + this.estimateTokens(m.content), 0);

      if (debug) {
        console.warn(`[LLM Assistant] Summary trigger: trimmedTokens=${trimmedTokens}, trigger=${summaryTriggerTokens}, willSummarize=${trimmedTokens >= summaryTriggerTokens}`);
      }

      if (trimmedTokens >= summaryTriggerTokens) {
        try {
          if (debug) console.warn('[LLM Assistant] Вызов summarizer.summarizeMessages()...');
          const summary = await this.summarizer.summarizeMessages(trimmed, provider, summaryModel);
          if (debug) console.warn(`[LLM Assistant] Summary результат: ${summary ? 'OK (' + summary.length + ' символов)' : 'null/пусто'}`);
          if (summary) {
            // Дебаг: логируем summary
            const debug = config.get<boolean>('debug', false);
            if (debug) {
              console.log(`[LLM Assistant] Summary сгенерирован (${trimmedTokens} токенов обрезано): ${summary.slice(0, 200)}...`);
            }
            const summaryMessage: ChatMessage = {
              role: 'system',
              content: `## Краткое содержание предыдущего диалога:\n${summary}`,
            };
            // Вставляем summary после основного system-сообщения
            const result = [systemMessage, summaryMessage, ...history];
            return result;
          }
        } catch (err) {
          // Если суммаризация упала — молча продолжаем без summary
          if (debug) console.warn('[LLM Assistant] Summary ОШИБКА:', err);
        }
      }
    }

    // Без summary: стандартное поведение
    return [systemMessage, ...history];
  }

  /** Только сообщения истории (без system prompt) — для внешнего управления */
  getMessagesForHistory(): ChatMessage[] {
    const { history } = this.buildHistoryWithTrimmed(Number.MAX_SAFE_INTEGER, 0);
    return history;
  }

  /**
   * Собрать историю сообщений с учётом лимита токенов.
   * Возвращает и включённые в контекст сообщения, и обрезанные (для summary).
   */
  private buildHistoryWithTrimmed(
    maxTokens: number,
    usedTokens: number,
  ): { history: ChatMessage[]; trimmed: ChatMessage[] } {
    const messages = this.sessionManager.getMessages();
    const history: ChatMessage[] = [];
    const trimmed: ChatMessage[] = [];
    let totalTokens = usedTokens;

    for (let i = messages.length - 1; i >= 0; i--) {
      const msg = messages[i];
      const msgTokens = this.estimateTokens(msg.content);

      // Контекст кода тоже учитываем в токенах
      const contextStr = (msg as ContextMessage).context?.content
        ? `\n\n--- Файл: ${(msg as ContextMessage).context!.filePath} ---\n\`\`\`\n${(msg as ContextMessage).context!.content}\n\`\`\``
        : '';
      const contextTokens = this.estimateTokens(contextStr);
      const totalMsgTokens = msgTokens + contextTokens;

      if (totalTokens + totalMsgTokens > maxTokens && history.length > 0) {
        // Это сообщение и все более старые — обрезаны
        for (let j = 0; j <= i; j++) {
          trimmed.push({
            role: messages[j].role,
            content: messages[j].content, // Без контекста кода — для summary не нужен
          });
        }
        break;
      }

      totalTokens += totalMsgTokens;
      history.unshift({
        role: msg.role,
        content: msg.content + contextStr,
      });
    }

    return { history, trimmed };
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
    // Инвалидируем кеш summary при добавлении новых сообщений
    this.summarizer.invalidateCache();
  }

  clearHistory(): void {
    this.sessionManager.clearActive();
    // Сбрасываем кеш summary
    this.summarizer.invalidateCache();
  }

  attachCodeContext(context: CodeContext): void {
    // Сохраняем как pending — прикрепится к следующему сообщению пользователя
    this.pendingContext = context;
  }

  /** Публичный доступ к оценщику токенов (для тестов и внешнего использования) */
  estimateTokens(text: string): number {
    return Math.ceil(text.length / 4);
  }
}
