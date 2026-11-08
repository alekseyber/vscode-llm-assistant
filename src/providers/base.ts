// Абстрактный базовый класс для всех LLM-провайдеров
// Определяет общую структуру: конструктор, базовые поля, методы chat() и models()

import { ChatMessage, CompletionOptions, LLMProvider, RetryCallback } from './types';

/**
 * Локальный ли провайдер по адресу.
 *
 * Признак локальности вешается на АДРЕС, а не на `type`: рядом с Ollama живут
 * другие движки с OpenAI-совместимым API (llama.cpp `llama-server`, LM Studio,
 * vLLM), и они подключаются записью `type: 'openai'`. Раньше `isLocal` и
 * нулевая цена выдавались только `type === 'ollama'`, поэтому локальный
 * openai-провайдер попадал в `DEFAULT_PRICING` ($0.50/$1.00) и показывал
 * выдуманную стоимость — тот же дефект, что ловили на `gemma3:4b` в 0.14.0.
 *
 * Loopback: `localhost`, `*.localhost`, `127.0.0.0/8`, `::1` — с портом и путём.
 * Адрес может быть задан без схемы (`127.0.0.1:8080/v1`).
 */
export function isLocalBaseUrl(baseUrl?: string): boolean {
  if (!baseUrl || typeof baseUrl !== 'string') return false;
  let host: string;
  try {
    const candidate = /^[a-z][a-z0-9+.-]*:\/\//i.test(baseUrl) ? baseUrl : `http://${baseUrl}`;
    host = new URL(candidate).hostname.toLowerCase().replace(/^\[|\]$/g, '');
  } catch {
    // Незаполненные ${ENV}-плейсхолдеры и прочий мусор локальными не считаем
    return false;
  }
  if (!host) return false;
  if (host === 'localhost' || host.endsWith('.localhost')) return true;
  if (host === '::1') return true;
  const v4 = /^127\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/.exec(host);
  return !!v4 && v4.slice(1).every((part) => Number(part) <= 255);
}

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