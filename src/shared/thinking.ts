// thinking.ts — управление режимом размышлений (thinking) для deepseek-моделей
// DeepSeek V4 по умолчанию включает reasoning: модель тратит maxTokens на reasoning_content,
// а content (полезный ответ) остаётся пустым или коротким. Параметр thinking:{type:'disabled'}
// отключает размышления. Автокомплит отключает их всегда; остальные режимы — по настройке
// llmAssistant.disableThinking.

import * as vscode from 'vscode';

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
