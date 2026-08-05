// OpenAI-совместимый провайдер (OpenAI, DeepSeek, локальные серверы)
// Обёртывает API-вызовы withRetry для обработки 429, 5xx, сетевых ошибок
// Отключает встроенные ретраи OpenAI SDK (maxRetries: 0) — используем свои

import * as vscode from 'vscode';
import OpenAI from 'openai';
import { BaseProvider } from './base';
import { ChatMessage, CompletionOptions, RetryCallback } from './types';
import { withRetry, DEFAULT_RETRY_OPTIONS } from '../shared/RetryHandler';

/**
 * Конфигурация ретраев, читаемая из настроек VS Code.
 */
interface RetryConfig {
  enabled: boolean;
  maxRetries: number;
  requestTimeout: number; // секунды
}

/**
 * Читает настройки ретраев из VS Code конфигурации.
 */
function getRetryConfig(): RetryConfig {
  const config = vscode.workspace.getConfiguration('llmAssistant');
  return {
    enabled: config.get<boolean>('retry.enabled', true),
    maxRetries: config.get<number>('retry.maxRetries', DEFAULT_RETRY_OPTIONS.maxRetries),
    requestTimeout: config.get<number>('retry.requestTimeout', DEFAULT_RETRY_OPTIONS.requestTimeoutMs / 1000),
  };
}

export class OpenAIProvider extends BaseProvider {
  private client: OpenAI;
  public readonly supportsVision: boolean;

  constructor(config: {
    name: string;
    baseUrl: string;
    apiKey: string;
    models: string[];
    supportsVision?: boolean;
  }) {
    super(config);
    this.supportsVision = config.supportsVision ?? false;
    // Отключаем встроенные ретраи OpenAI SDK — используем свои через withRetry
    this.client = new OpenAI({ apiKey: this.apiKey, baseURL: this.baseUrl, maxRetries: 0 });
  }

  /**
   * Стриминговый чат-запрос с опциональными ретраями.
   * Ретраит только первоначальный запрос (создание стрима).
   * Если стрим уже начался и оборвался — ошибка пробрасывается без ретрая.
   */
  async *chat(
    messages: ChatMessage[],
    options: CompletionOptions,
    signal?: AbortSignal,
    onRetry?: RetryCallback,
  ): AsyncIterable<string> {
    const retryConfig = getRetryConfig();

    const stream = retryConfig.enabled
      ? await withRetry(
          (retrySignal) =>
            this.client.chat.completions.create(
              {
                model: options.model,
                messages: messages.map((m) => ({ role: m.role, content: m.content })),
                temperature: options.temperature ?? 0.7,
                max_tokens: options.maxTokens ?? 4096,
                stream: true,
              },
              { signal: retrySignal },
            ),
          {
            signal,
            onRetry,
            maxRetries: retryConfig.maxRetries,
            requestTimeoutMs: retryConfig.requestTimeout * 1000,
          },
        )
      : await this.client.chat.completions.create(
          {
            model: options.model,
            messages: messages.map((m) => ({ role: m.role, content: m.content })),
            temperature: options.temperature ?? 0.7,
            max_tokens: options.maxTokens ?? 4096,
            stream: true,
          },
          { signal },
        );

    for await (const chunk of stream) {
      if (signal?.aborted) break;
      const content = chunk.choices?.[0]?.delta?.content;
      if (content) yield content;
    }
  }

  /**
   * Vision-запрос: сообщения с изображениями.
   * Поддерживает ретраи аналогично chat().
   */
  async *chatWithVision(
    messages: Array<{ role: string; content: any }>,
    options: CompletionOptions,
    signal?: AbortSignal,
    onRetry?: RetryCallback,
  ): AsyncIterable<string> {
    const retryConfig = getRetryConfig();

    const stream = retryConfig.enabled
      ? await withRetry(
          (retrySignal) =>
            this.client.chat.completions.create(
              {
                model: options.model,
                messages: messages as any,
                temperature: options.temperature ?? 0.7,
                max_tokens: options.maxTokens ?? 4096,
                stream: true,
              },
              { signal: retrySignal },
            ),
          {
            signal,
            onRetry,
            maxRetries: retryConfig.maxRetries,
            requestTimeoutMs: retryConfig.requestTimeout * 1000,
          },
        )
      : await this.client.chat.completions.create(
          {
            model: options.model,
            messages: messages as any,
            temperature: options.temperature ?? 0.7,
            max_tokens: options.maxTokens ?? 4096,
            stream: true,
          },
          { signal },
        );

    for await (const chunk of stream) {
      if (signal?.aborted) break;
      const content = chunk.choices?.[0]?.delta?.content;
      if (content) yield content;
    }
  }

  /**
   * Запрос с tools (function calling) для ReAct-агента.
   * Нестриминговый — результат возвращается целиком.
   */
  async createWithTools(
    messages: any[],
    model: string,
    tools: any[],
    signal?: AbortSignal,
    onRetry?: RetryCallback,
  ): Promise<any> {
    const retryConfig = getRetryConfig();

    if (!retryConfig.enabled) {
      return this.client.chat.completions.create(
        { model, messages, tools: tools as any, tool_choice: 'auto' },
        { signal },
      );
    }

    return withRetry(
      (retrySignal) =>
        this.client.chat.completions.create(
          { model, messages, tools: tools as any, tool_choice: 'auto' },
          { signal: retrySignal },
        ),
      {
        signal,
        onRetry,
        maxRetries: retryConfig.maxRetries,
        requestTimeoutMs: retryConfig.requestTimeout * 1000,
      },
    );
  }

  /**
   * Нестриминговый запрос к LLM — возвращает полный текст ответа.
   * Используется для summary (сжатия истории) и других задач без стриминга.
   */
  async chatComplete(
    messages: ChatMessage[],
    options: CompletionOptions,
    signal?: AbortSignal,
    onRetry?: RetryCallback,
  ): Promise<string> {
    const retryConfig = getRetryConfig();

    const response = retryConfig.enabled
      ? await withRetry(
          (retrySignal) =>
            this.client.chat.completions.create(
              {
                model: options.model,
                messages: messages.map((m) => ({ role: m.role, content: m.content })),
                temperature: options.temperature ?? 0.3,
                max_tokens: options.maxTokens ?? 2048,
                stream: false,
              },
              { signal: retrySignal },
            ),
          {
            signal,
            onRetry,
            maxRetries: retryConfig.maxRetries,
            requestTimeoutMs: retryConfig.requestTimeout * 1000,
          },
        )
      : await this.client.chat.completions.create(
          {
            model: options.model,
            messages: messages.map((m) => ({ role: m.role, content: m.content })),
            temperature: options.temperature ?? 0.3,
            max_tokens: options.maxTokens ?? 2048,
            stream: false,
          },
          { signal },
        );

    return response.choices?.[0]?.message?.content ?? '';
  }
}
