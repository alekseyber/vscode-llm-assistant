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

/**
 * Ошибки соединения у OpenAI-совместимых провайдеров приходят из SDK как
 * `APIConnectionError: Connection error.` — по такому тексту пользователь не понимает,
 * что локальный движок просто не запущен. Оборачиваем только сетевой класс:
 * HTTP-ошибки (401/404/429) обязаны дойти до RetryHandler нетронутыми, со `status`.
 */
export function toProviderError(error: any, baseUrl: string, isLocal: boolean): Error {
  if (error?.status) return error;
  const code: string =
    error?.code || error?.cause?.code || (error?.name === 'APIConnectionError' ? 'ECONNREFUSED' : 'NETWORK_ERROR');
  const rawMessage = error?.message || String(error);
  const isConnection =
    error?.name === 'APIConnectionError' ||
    /connection error|fetch failed|ECONNREFUSED|ENOTFOUND|ETIMEDOUT|EAI_AGAIN/i.test(rawMessage) ||
    !!error?.cause?.code;
  if (!isConnection) return error;

  const message = isLocal
    ? `Не удалось подключиться к локальному серверу (${baseUrl}) (${code}). ` +
      'Сервер мог быть остановлен намеренно — запустите его перед запросом. ' +
      'Проверьте также, что baseUrl верный.'
    : `Не удалось подключиться к провайдеру (${code}): ${rawMessage.replace(/\.$/, '')}. Проверьте сеть и baseUrl.`;
  const wrapped: any = new Error(message);
  wrapped.code = code;
  wrapped.cause = error;
  return wrapped;
}

export class OpenAIProvider extends BaseProvider {
  private client: OpenAI;
  public readonly supportsVision: boolean;
  /**
   * Локальный движок с OpenAI-совместимым API (llama.cpp, LM Studio, vLLM).
   * Признак приходит из `ProviderManager` — он решает по АДРЕСУ, а не по `type`.
   */
  public readonly isLocal?: boolean;
  /** Переопределение агентского цикла для этого провайдера */
  public readonly toolLoopOverride?: boolean;

  constructor(config: {
    name: string;
    baseUrl: string;
    apiKey: string
    models: string[];
    supportsVision?: boolean;
    isLocal?: boolean;
    toolLoop?: boolean;
  }) {
    super(config);
    this.supportsVision = config.supportsVision ?? false;
    this.isLocal = config.isLocal === true;
    this.toolLoopOverride = typeof config.toolLoop === 'boolean' ? config.toolLoop : undefined;
    // Отключаем встроенные ретраи OpenAI SDK — используем свои через withRetry
    this.client = new OpenAI({ apiKey: this.apiKey, baseURL: this.baseUrl, maxRetries: 0 });
  }

  /**
   * Единственная точка вызова API: сетевые ошибки превращаются в человеческий текст,
   * HTTP-ошибки проходят как есть (по `status` их классифицирует `RetryHandler`).
   */
  private async call(request: any, signal?: AbortSignal): Promise<any> {
    try {
      return await this.client.chat.completions.create(request, { signal });
    } catch (error: any) {
      throw toProviderError(error, this.baseUrl, this.isLocal === true);
    }
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
            this.call(
              {
                model: options.model,
                messages: messages.map((m) => ({ role: m.role, content: m.content })),
                temperature: options.temperature ?? 0.7,
                max_tokens: options.maxTokens ?? 4096,
                stream: true,
                ...(options.extraBody ?? {}),
              },
              retrySignal,
            ),
          {
            signal,
            onRetry,
            maxRetries: retryConfig.maxRetries,
            requestTimeoutMs: retryConfig.requestTimeout * 1000,
          },
        )
      : await this.call(
          {
            model: options.model,
            messages: messages.map((m) => ({ role: m.role, content: m.content })),
            temperature: options.temperature ?? 0.7,
            max_tokens: options.maxTokens ?? 4096,
            stream: true,
            ...(options.extraBody ?? {}),
          },
          signal,
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
            this.call(
              {
                model: options.model,
                messages: messages as any,
                temperature: options.temperature ?? 0.7,
                max_tokens: options.maxTokens ?? 4096,
                stream: true,
              },
              retrySignal,
            ),
          {
            signal,
            onRetry,
            maxRetries: retryConfig.maxRetries,
            requestTimeoutMs: retryConfig.requestTimeout * 1000,
          },
        )
      : await this.call(
          {
            model: options.model,
            messages: messages as any,
            temperature: options.temperature ?? 0.7,
            max_tokens: options.maxTokens ?? 4096,
            stream: true,
          },
          signal,
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
    extraBody?: Record<string, any>,
  ): Promise<any> {
    const retryConfig = getRetryConfig();
    // extraBody — дополнительные поля тела (например thinking:{type:'disabled'}):
    // без него агентский шаг deepseek тратит бюджет на рассуждение и возвращает пустой content.
    const request = {
      model,
      messages,
      tools: tools as any,
      tool_choice: 'auto' as const,
      ...(extraBody ?? {}),
    };

    if (!retryConfig.enabled) {
      return this.call(request, signal);
    }

    return withRetry(
      (retrySignal) => this.call(request, retrySignal),
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
            this.call(
              {
                model: options.model,
                messages: messages.map((m) => ({ role: m.role, content: m.content })),
                temperature: options.temperature ?? 0.3,
                max_tokens: options.maxTokens ?? 2048,
                stream: false,
              },
              retrySignal,
            ),
          {
            signal,
            onRetry,
            maxRetries: retryConfig.maxRetries,
            requestTimeoutMs: retryConfig.requestTimeout * 1000,
          },
        )
      : await this.call(
          {
            model: options.model,
            messages: messages.map((m) => ({ role: m.role, content: m.content })),
            temperature: options.temperature ?? 0.3,
            max_tokens: options.maxTokens ?? 2048,
            stream: false,
          },
          signal,
        );

    return response.choices?.[0]?.message?.content ?? '';
  }
}
