// Абстрактный базовый класс для всех LLM-провайдеров
// Определяет общую структуру: конструктор, базовые поля, методы chat() и models()

import { ChatMessage, CompletionOptions, LLMProvider, RetryCallback } from './types';

/**
 * Абстрактный BaseProvider — шаблон для всех OpenAI-совместимых провайдеров.
 * Содержит базовую конфигурацию (name, baseUrl, apiKey, models) и определяет
 * контракт методов chat() и models(), которые должны быть реализованы в подклассе.
 */
export abstract class BaseProvider implements LLMProvider {
  /** Название провайдера (например, 'openai', 'deepseek') */
  public readonly name: string;
  /** Базовый URL API (например, 'https://api.openai.com/v1') */
  protected readonly baseUrl: string;
  /** API ключ для аутентификации */
  protected readonly apiKey: string;
  /** Список доступных моделей */
  protected readonly modelsList: string[];

  /**
   * @param config - объект конфигурации провайдера
   */
  constructor(config: { name: string; baseUrl: string; apiKey: string; models: string[] }) {
    this.name = config.name;
    // Убираем trailing slash из baseUrl для единообразия
    this.baseUrl = config.baseUrl.replace(/\/+$/, '');
    this.apiKey = config.apiKey;
    this.modelsList = config.models;
  }

  /**
   * Отправить сообщения в чат с LLM.
   * Абстрактный метод — каждый провайдер реализует свою логику отправки запроса.
   * 
   * @param messages - история сообщений
   * @param options - опции запроса (модель, температура, макс. токены)
   * @param signal - опциональный сигнал для отмены запроса
   * @returns AsyncIterable<string> — поток строк (токенов)
   */
  abstract chat(
    messages: ChatMessage[],
    options: CompletionOptions,
    signal?: AbortSignal,
    onRetry?: RetryCallback
  ): AsyncIterable<string>;

  /**
   * Получить список доступных моделей для этого провайдера.
   * Базовый возвращает список из конфига, но подклассы могут переопределить
   * для динамического получения списка через API.
   * 
   * @returns Promise со списком имён моделей
   */
  async models(): Promise<string[]> {
    return [...this.modelsList];
  }
}