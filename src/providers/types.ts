// Типы данных для системы провайдеров LLM
// Определяет интерфейсы для конфигурации, сообщений, опций и провайдеров

import { RetryCallback } from '../shared/RetryHandler';
export type { RetryCallback } from '../shared/RetryHandler';

/**
 * Конфигурация провайдера — читается из settings.json
 */
export interface ProviderConfig {
  name: string;
  baseUrl: string;
  apiKey: string;
  models: string[];
  /** Поддержка vision (изображений) */
  supportsVision?: boolean;
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
  /** Название провайдера (например, 'openai', 'deepseek') */
  readonly name: string;

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
    signal?: AbortSignal,
    onRetry?: RetryCallback
  ): AsyncIterable<string>;

  /** Выполнить запрос с tools (function calling) для ReAct-агента */
  createWithTools?(messages: any[], model: string, tools: any[], signal?: AbortSignal, onRetry?: RetryCallback): Promise<any>;

  /**
   * Нестриминговый запрос к LLM — возвращает полный текст ответа.
   * Используется для summary, классификации и других задач,
   * где не нужен потоковый вывод.
   */
  chatComplete?(
    messages: ChatMessage[],
    options: CompletionOptions,
    signal?: AbortSignal,
    onRetry?: RetryCallback
  ): Promise<string>;

  /** Получить список доступных моделей */
  models(): Promise<string[]>;
}

/**
 * Цены модели: доллары за 1M токенов.
 */
export interface ModelPricing {
  input: number;
  output: number;
}

/** Конфигурация модели с опциональной ценой */
export interface ModelConfig {
  name: string;
  pricing?: ModelPricing;
}

/** Элемент списка моделей: строка или объект с ценой */
export type ModelEntry = string | ModelConfig;

/** Карта цен моделей */
export type PricingMap = Map<string, ModelPricing>;

/** Хардкод-таблица цен (USD за 1M токенов), fallback */
const FALLBACK_PRICING: Record<string, ModelPricing> = {
  'deepseek-chat': { input: 0.14, output: 0.28 },
  'deepseek-v4-pro': { input: 0.435, output: 0.87 },
  'deepseek-v4-flash': { input: 0.14, output: 0.28 },
  'deepseek-v4-pro-origin': { input: 0.435, output: 0.87 },
  'gpt-4o': { input: 2.50, output: 10.00 },
  'gpt-4o-mini': { input: 0.15, output: 0.60 },
  'claude-sonnet-4': { input: 3.00, output: 15.00 },
  'Qwen/Qwen3.5-32B': { input: 0.07, output: 0.27 },
};

const DEFAULT_PRICING: ModelPricing = { input: 0.50, output: 1.00 };

/** Извлечь имена моделей из списка */
export function extractModelNames(models: ModelEntry[]): string[] {
  return models.map(m => typeof m === 'string' ? m : m.name);
}

/** Построить карту цен из конфига */
export function buildPricingMap(models: ModelEntry[]): PricingMap {
  const map = new Map<string, ModelPricing>();
  for (const entry of models) {
    if (typeof entry === 'string') {
      if (FALLBACK_PRICING[entry]) map.set(entry, FALLBACK_PRICING[entry]);
    } else {
      map.set(entry.name, entry.pricing || FALLBACK_PRICING[entry.name] || DEFAULT_PRICING);
    }
  }
  return map;
}

/** Рассчитать стоимость в USD */
export function calculateCost(model: string, inputTokens: number, outputTokens: number, pricingMap?: PricingMap): number {
  const price = pricingMap?.get(model) || FALLBACK_PRICING[model] || DEFAULT_PRICING;
  return Math.round(((inputTokens / 1_000_000) * price.input + (outputTokens / 1_000_000) * price.output) * 1e6) / 1e6;
}