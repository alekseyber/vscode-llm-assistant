// ConversationManager — управление историей сообщений чата
// Делегирует хранение SessionManager, добавляет логику контекста и системного промпта
// Слой 04 Context Management: summary при переполнении контекста

import * as vscode from 'vscode';
import { ChatMessage } from '../../providers/types';
import { SessionManager } from './SessionManager';
import { loadAgentsMd } from '../../shared/AgentsMdLoader';
import { ContextSummarizer } from '../../shared/ContextSummarizer';
import { SessionLog } from '../../shared/SessionLog';

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
  /** Лог сессий (F1) — если задан, addMessageTo пишет события (5a) */
  private sessionLog?: SessionLog;
  /** Контекст кода для следующего запроса */
  private pendingContext: CodeContext | null = null;
  /** Суммаризатор для сжатия обрезанной истории */
  private summarizer: ContextSummarizer = new ContextSummarizer();

  constructor(storage: vscode.Memento, sessionLog?: SessionLog) {
    this.sessionManager = new SessionManager(storage);
    this.sessionLog = sessionLog;
  }

  get session(): SessionManager {
    return this.sessionManager;
  }

  getMessages(): ContextMessage[] {
    // F1 5c: при наличии лога — проекция из него (fallback на SessionManager.messages)
    const sessionId = this.sessionManager.getActive()?.meta.id;
    if (this.sessionLog && sessionId) {
      return this.sessionLog.deriveMessages(sessionId, { includeContext: false }) as ContextMessage[];
    }
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

    // F1 5b: проекция истории из session-log; fallback на SessionManager.messages (без лога)
    const sessionId = this.sessionManager.getActive()?.meta.id;
    let history: ChatMessage[];
    let trimmed: ChatMessage[];
    if (this.sessionLog && sessionId) {
      const r = this.sessionLog.deriveMessagesWithTrimmed(sessionId, maxTokens - usedTokens);
      history = r.messages;
      trimmed = r.trimmed;
    } else {
      const r = this.buildHistoryWithTrimmed(maxTokens, usedTokens);
      history = r.history;
      trimmed = r.trimmed;
    }

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
            if (this.sessionLog && sessionId) {
              // F1 (5b + storage-гигиена): персист summary-маркера + обрезка старых событий
              const keptCount = history.filter(m => m.role !== 'system').length;
              this.sessionLog.truncate(sessionId, summary, keptCount);
              history = this.sessionLog.deriveMessages(sessionId);
              return [systemMessage, ...history];
            }
            const summaryMessage: ChatMessage = {
              role: 'system',
              content: `## Краткое содержание предыдущего диалога:\n${summary}`,
            };
            // Вставляем summary после основного system-сообщения
            return [systemMessage, summaryMessage, ...history];
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

    // Диагностика: логируем входные параметры
    const debug = vscode.workspace.getConfiguration('llmAssistant').get<boolean>('debug', false);
    if (debug) {
      console.warn(`[LLM Assistant] buildHistory: allMessages=${messages.length}, maxTokens=${maxTokens}, usedBySystem=${usedTokens}, budget=${maxTokens - usedTokens}`);
    }

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
        if (debug) {
          console.warn(`[LLM Assistant] buildHistory: trimmed=${trimmed.length} (messages[0..${i}]), kept=${history.length}, totalTokens=${totalTokens}/${maxTokens}`);
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
    this.addMessageTo(this.sessionManager.getActive()?.meta.id, message);
  }

  /** Добавить сообщение в конкретную сессию (по id) — для сессионной маршрутизации */
  addMessageTo(sessionId: string | undefined, message: ContextMessage): void {
    const targetId = sessionId || this.sessionManager.getActive()?.meta.id;
    if (!targetId) return;
    // Добавляем pending-контекст к пользовательским сообщениям
    if (message.role === 'user' && this.pendingContext) {
      message.context = this.pendingContext;
      this.pendingContext = null;
    }
    // F1 (5a/5d): session-log — единственный источник сообщений; fallback на SessionManager.messages
    if (this.sessionLog) {
      this.logMessage(targetId, message);
      const stats = this.sessionLog.computeStats(targetId);
      this.sessionManager.touchSession(targetId, stats.userMessages + stats.assistantMessages);
    } else {
      this.sessionManager.addMessageTo(targetId, message);
    }
    // Авто-имя сессии из первого сообщения
    if (message.role === 'user') {
      this.sessionManager.autoNameSession(targetId, message.content);
    }
    // Инвалидируем кеш summary при добавлении новых сообщений
    this.summarizer.invalidateCache();

    // Диагностика: логируем состояние после каждого addMessage
    const debug = vscode.workspace.getConfiguration('llmAssistant').get<boolean>('debug', false);
    if (debug) {
      const totalMessages = this.sessionLog
        ? this.sessionLog.computeStats(targetId).userMessages + this.sessionLog.computeStats(targetId).assistantMessages
        : this.sessionManager.getMessages().length;
      console.warn(`[LLM Assistant] addMessageTo: role=${message.role}, totalMessages=${totalMessages}, session=${targetId?.slice(0, 16) ?? 'none'}`);
    }
  }

  /** Записать сообщение в session-log как событие (F1 5a) */
  private logMessage(sessionId: string, message: ContextMessage): void {
    if (!this.sessionLog) return;
    const ts = Date.now();
    if (message.role === 'user') {
      this.sessionLog.append({
        sessionId,
        ts,
        type: 'user/message',
        content: message.content,
        pendingContext: message.context?.content
          ? `--- Файл: ${message.context.filePath} ---\n\`\`\`\n${message.context.content}\n\`\`\``
          : undefined,
      });
    } else if (message.role === 'assistant') {
      this.sessionLog.append({ sessionId, ts, type: 'assistant/message', content: message.content });
    }
  }

  clearHistory(): void {
    const sessionId = this.sessionManager.getActive()?.meta.id;
    this.sessionManager.clearActive();
    // F1 5c: очищаем и лог активной сессии
    if (sessionId && this.sessionLog) {
      this.sessionLog.clearSession(sessionId);
    }
    // Сбрасываем кеш summary
    this.summarizer.invalidateCache();
  }

  /** Удалить все сессии и их логи (полная очистка). */
  clearAll(): void {
    this.sessionLog?.clearAll();
    this.sessionManager.clearAll();
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
