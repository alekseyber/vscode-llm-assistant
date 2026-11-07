// thinking.ts — управление режимом размышлений (thinking) для deepseek-моделей
// DeepSeek V4 по умолчанию включает reasoning: модель тратит maxTokens на reasoning_content,
// а content (полезный ответ) остаётся пустым или коротким. Параметр thinking:{type:'disabled'}
// отключает размышления. Автокомплит отключает их всегда; остальные режимы — по настройке
// llmAssistant.disableThinking.

import * as vscode from 'vscode';

/** Вход решения «гасить ли рассуждение» — передаётся явно, чтобы функция была чистой. */
export interface ThinkingDecisionInput {
  /** Имя модели (например, 'deepseek-v4-flash', 'qwen3:8b') */
  model: string;
  /** Локальный провайдер (Ollama): рассуждение гасится флагом `think` внутри провайдера */
  isLocal?: boolean;
  /** Значение llmAssistant.disableThinking */
  disableThinking: boolean;
  /** Режим, в котором thinking выключается всегда (автокомплит) */
  always?: boolean;
}

/**
 * Нужно ли гасить рассуждение в этом запросе.
 *
 * Чистая функция без обращений к vscode — поэтому покрывается юнит-тестом напрямую.
 * Не описывает, *как* гасить: для deepseek это `extraBody` с `thinking`, для локального
 * провайдера — флаг `think` в нативном запросе (его ставит OllamaProvider).
 */
export function shouldDisableThinking(input: ThinkingDecisionInput): boolean {
  const { model, isLocal, disableThinking, always } = input;
  if (isLocal) return true;
  if (!/deepseek/i.test(model)) return false;
  return Boolean(always) || disableThinking;
}

/**
 * Собрать extraBody с отключением thinking для deepseek-моделей.
 * Возвращает undefined, если модель не deepseek или отключение не требуется.
 *
 * @param model - имя модели (например, 'deepseek-ai/DeepSeek-V4-Flash-0731')
 * @returns extraBody для запроса или undefined
 */
export function buildThinkingExtraBody(model: string): Record<string, any> | undefined {
  // Параметр thinking поддерживают только deepseek-модели
  if (!/deepseek/i.test(model)) {
    return undefined;
  }

  const config = vscode.workspace.getConfiguration('llmAssistant');
  const disableThinking = config.get<boolean>('disableThinking', false);
  if (!disableThinking) {
    return undefined;
  }

  return { thinking: { type: 'disabled' } };
}
