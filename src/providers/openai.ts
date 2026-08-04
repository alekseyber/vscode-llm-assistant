import OpenAI from 'openai';
import { BaseProvider } from './base';
import { ChatMessage, CompletionOptions } from './types';

export class OpenAIProvider extends BaseProvider {
  private client: OpenAI;
  public readonly supportsVision: boolean;

  constructor(config: { name: string; baseUrl: string; apiKey: string; models: string[]; supportsVision?: boolean }) {
    super(config);
    this.supportsVision = config.supportsVision ?? false;
    this.client = new OpenAI({ apiKey: config.apiKey, baseURL: this.baseUrl });
  }

  async *chat(messages: ChatMessage[], options: CompletionOptions, signal?: AbortSignal): AsyncIterable<string> {
    const stream = await this.client.chat.completions.create({
      model: options.model,
      messages: messages.map(m => ({ role: m.role, content: m.content })),
      temperature: options.temperature ?? 0.7,
      max_tokens: options.maxTokens ?? 4096,
      stream: true,
    }, { signal });
    for await (const chunk of stream) {
      if (signal?.aborted) break;
      const content = chunk.choices?.[0]?.delta?.content;
      if (content) yield content;
    }
  }

  /** Vision-запрос: сообщения с изображениями */
  async *chatWithVision(messages: Array<{role: string; content: any}>, options: CompletionOptions, signal?: AbortSignal): AsyncIterable<string> {
    const stream = await this.client.chat.completions.create({
      model: options.model,
      messages: messages as any,
      temperature: options.temperature ?? 0.7,
      max_tokens: options.maxTokens ?? 4096,
      stream: true,
    }, { signal });
    for await (const chunk of stream) {
      if (signal?.aborted) break;
      const content = chunk.choices?.[0]?.delta?.content;
      if (content) yield content;
    }
  }
}
