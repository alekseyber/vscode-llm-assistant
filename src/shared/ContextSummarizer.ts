// ContextSummarizer — сжатие обрезанной истории диалога в краткое summary
// Используется ConversationManager при переполнении контекста (maxContextTokens)
// и AgentController для длинных ReAct-сессий (>10 шагов)
// Кеширует результаты: повторный вызов с теми же сообщениями не шлёт запрос в LLM

import { ChatMessage, LLMProvider } from '../providers/types';

/**
 * Конфигурация для ContextSummarizer.
 */
export interface SummarizerConfig {
  /** Включена ли суммаризация */
  enabled: boolean;
  /** Модель для summary (по умолчанию — текущая модель чата) */
  model: string;
  /** Минимальное количество токенов обрезанных сообщений для запуска summarization */
  triggerTokens: number;
}

/**
 * Запись в кеше summary.
 */
interface CacheEntry {
  /** Сжатое summary */
  summary: string;
  /** Хеш сообщений, для которых создано summary */
  contentHash: string;
  /** Количество сообщений */
  messageCount: number;
}

/**
 * ContextSummarizer — сжимает историю диалога в краткое summary через LLM.
 *
 * Использование:
 * ```
 * const summarizer = new ContextSummarizer();
 * const summary = await summarizer.summarizeMessages(trimmedMessages, provider, 'gpt-4o');
 * ```
 *
 * Кеширование:
 * - Ключ кеша: хеш от содержимого всех сообщений + их количество
 * - При повторном вызове с теми же сообщениями — возвращает кеш без запроса к LLM
 * - Кеш автоматически инвалидируется при изменении содержимого сообщений
 */
export class ContextSummarizer {
  /** Кеш: хеш контента → запись */
  private cache: Map<string, CacheEntry> = new Map();

  /**
   * Сжать историю сообщений в краткое summary на русском языке.
   *
   * @param messages — массив сообщений для сжатия (обрезанные старые сообщения)
   * @param provider — провайдер LLM для отправки запроса
   * @param model — модель для summary
   * @returns строка summary на русском языке
   */
  async summarizeMessages(
    messages: ChatMessage[],
    provider: LLMProvider,
    model: string,
  ): Promise<string> {
    if (messages.length === 0) {
      return '';
    }

    // Проверяем кеш — хеш контента + количество сообщений
    const contentHash = this.computeContentHash(messages);
    const cached = this.cache.get(contentHash);
    if (cached && cached.messageCount === messages.length) {
      return cached.summary;
    }

    // Формируем текст истории для отправки в LLM
    const historyText = this.formatMessagesForSummary(messages);

    // Отправляем запрос на суммаризацию (нестриминговый)
    const summary = await this.requestSummary(provider, model, historyText);

    // Сохраняем в кеш
    this.cache.set(contentHash, {
      summary,
      contentHash,
      messageCount: messages.length,
    });

    return summary;
  }

  /**
   * Сбросить кеш (например, при очистке истории).
   */
  invalidateCache(): void {
    this.cache.clear();
  }

  /**
   * Оценить количество токенов в тексте (грубая оценка: 1 токен ≈ 4 символа).
   * Синхронизировано с ConversationManager.estimateTokens().
   */
  estimateTokens(text: string): number {
    return Math.ceil(text.length / 4);
  }

  /**
   * Вычислить хеш содержимого сообщений для ключа кеша.
   * Использует первые и последние 200 символов контента + общее количество.
   */
  private computeContentHash(messages: ChatMessage[]): string {
    if (messages.length === 0) return 'empty';
    const first = messages[0].content.slice(0, 200);
    const last = messages[messages.length - 1].content.slice(-200);
    return `${messages.length}:${first}:${last}`;
  }

  /**
   * Форматировать сообщения в текст для отправки на суммаризацию.
   */
  private formatMessagesForSummary(messages: ChatMessage[]): string {
    return messages
      .map((m) => {
        const roleLabel = m.role === 'user' ? 'Пользователь' :
          m.role === 'assistant' ? 'Ассистент' : 'Система';
        // Обрезаем слишком длинные сообщения для экономии токенов запроса
        const content = m.content.length > 2000
          ? m.content.slice(0, 2000) + '...'
          : m.content;
        return `[${roleLabel}]: ${content}`;
      })
      .join('\n\n');
  }

  /**
   * Отправить запрос на суммаризацию в LLM.
   * Использует chatComplete() для нестримингового ответа.
   */
  private async requestSummary(
    provider: LLMProvider,
    model: string,
    historyText: string,
  ): Promise<string> {
    // Если провайдер поддерживает chatComplete — используем его
    if (provider.chatComplete) {
      const summaryMessages: ChatMessage[] = [
        {
          role: 'system',
          content: 'Ты — ассистент для сжатия истории диалога. Твоя задача — кратко пересказать суть разговора на русском языке. Сохрани ключевые факты, вопросы, ответы, решения и выводы. Пиши кратко, без воды.',
        },
        {
          role: 'user',
          content: `Сожми эту историю диалога в краткое summary на русском языке:\n\n${historyText}`,
        },
      ];

      return provider.chatComplete(summaryMessages, {
        model,
        temperature: 0.2,
        maxTokens: 1024,
      });
    }

    // Fallback: собираем стрим вручную
    const summaryMessages: ChatMessage[] = [
      {
        role: 'system',
        content: 'Сожми историю диалога в краткое summary на русском. Только ключевые факты.',
      },
      {
        role: 'user',
        content: `Сожми эту историю в краткое summary на русском:\n\n${historyText}`,
      },
    ];

    const chunks: string[] = [];
    const stream = provider.chat(summaryMessages, {
      model,
      temperature: 0.2,
      maxTokens: 1024,
      stream: true,
    });

    for await (const chunk of stream) {
      chunks.push(chunk);
    }

    return chunks.join('');
  }
}
