// Типы данных для системы провайдеров LLM
// Определяет интерфейсы для конфигурации, сообщений, опций и провайдеров

/**
 * Конфигурация провайдера — читается из settings.json
 */
export interface ProviderConfig {
  /** Название провайдера (например, 'openai', 'deepseek') */
  name: string;
  /** Базовый URL API (например, 'https://api.openai.com/v1') */
  baseUrl: string;
  /** API ключ для аутентификации */
  apiKey: string;
  /** Список доступных моделей */
  models: string[];
}

/**
 * Сообщение в чате с LLM
 */
export interface ChatMessage {
  /** Роль отправителя: system (системный промпт), user (пользователь), assistant (ассистент) */
  role: 'system' | 'user' | 'assistant';
  /** Текст сообщения */
  content: string;
}

/**
 * Опции для запроса к LLM
 */
export interface CompletionOptions {
  /** Имя модели (например, 'gpt-4o', 'deepseek-chat') */
  model: string;
  /** Температура (креативность) 0-2, по умолчанию 0.7 */
  temperature?: number;
  /** Максимум токенов в ответе, по умолчанию 4096 */
  maxTokens?: number;
  /** Включить стриминг (по умолчанию true) */
  stream?: boolean;
}

/**
 * Единый интерфейс для всех LLM-провайдеров
 * Все провайдеры должны реализовать этот интерфейс
 */
export interface LLMProvider {
  /**
   * Отправить сообщения в чат и получить стриминг ответа
   * @param messages - история сообщений
   * @param options - опции модели
   * @param signal - опциональный сигнал для отмены запроса
   * @returns AsyncIterable<string> — поток строк (токенов)
   */
  chat(
    messages: ChatMessage[],
    options: CompletionOptions,
    signal?: AbortSignal
  ): AsyncIterable<string>;

  /**
   * Получить список доступных моделей
   * @returns Promise со списком имён моделей
   */
  models(): Promise<string[]>;
}