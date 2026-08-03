// Провайдер для OpenAI-совместимых API
// Отправляет POST /v1/chat/completions с stream: true
// Парсит SSE-поток (data: {...}\\n\\n) и возвращает токены через AsyncIterable
// Поддерживает AbortSignal для отмены запроса

import OpenAI from 'openai';
import { BaseProvider } from './base';
import { ChatMessage, CompletionOptions } from './types';

/**
 * OpenAIProvider — реализация для OpenAI-совместимых API.
 * 
 * Поддерживает:
 * - Стриминг через SSE (Server-Sent Events) 
 * - AbortSignal для отмены запроса
 * - Совместимость с OpenAI, DeepSeek, Ollama и любыми OpenAI-совместимыми API
 * 
 * Использует официальный OpenAI SDK v4, который обрабатывает HTTP-запросы,
 * парсинг SSE и управление стримом.
 */
export class OpenAIProvider extends BaseProvider {
  /** Инстанс OpenAI SDK */
  private client: OpenAI;

  /**
   * @param config - конфигурация провайдера (name, baseUrl, apiKey, models)
   */
  constructor(config: { name: string; baseUrl: string; apiKey: string; models: string[] }) {
    super(config);
    this.client = new OpenAI({
      apiKey: this.apiKey,
      baseURL: this.baseUrl,
    });
  }

  /**
   * Отправить сообщения в чат и получить поток токенов через SSE.
   * 
   * Использует OpenAI SDK v4 с параметром stream: true.
   * SDK сам обрабатывает парсинг SSE-событий и возвращает AsyncIterable.
   * Каждый chunk содержит часть ответа (delta content).
   * 
   * @param messages - история сообщений для отправки
   * @param options - опции запроса (модель, температура, макс. токены)
   * @param signal - AbortSignal для отмены запроса
   * @returns AsyncIterable<string> — генератор, выдающий токены по мере поступления
   * 
   * @throws OpenAI.APIError при ошибке API (401, 403, 429, 500+)
   * @throws AbortError при отмене запроса через AbortSignal
   */
  async *chat(
    messages: ChatMessage[],
    options: CompletionOptions,
    signal?: AbortSignal
  ): AsyncIterable<string> {
    // Создаём запрос с stream: true
    const stream = await this.client.chat.completions.create(
      {
        model: options.model,
        messages: messages.map(m => ({
          role: m.role,
          content: m.content,
        })),
        temperature: options.temperature ?? 0.7,
        max_tokens: options.maxTokens ?? 4096,
        stream: true,
      },
      {
        // Передаём AbortSignal для поддержки отмены
        signal: signal,
      }
    );

    // Итерируемся по SSE-потоку и выдаём каждый токен
    for await (const chunk of stream) {
      // Проверка на отмену запроса пользователем
      if (signal?.aborted) {
        break;
      }

      // Извлекаем содержимое из delta-чанка SSE
      const content = chunk.choices?.[0]?.delta?.content;
      if (content) {
        yield content;
      }
    }
  }
}