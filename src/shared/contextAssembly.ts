// Сборка контекста запроса — чистая функция, без зависимости от vscode.
//
// Зачем отдельный модуль: этот же код вызывает панель чата и стенд evals.
// Пока стенд собирал контекст своими руками, он проверял модель на вырезанном
// фрагменте, а не продукт: ошибка в сборке контекста не могла уронить стенд.

import { ChatMessage } from '../providers/types';

/** Контекст кода, прикреплённый к сообщению пользователя */
export interface CodeContext {
  filePath: string;
  content: string;
  selectionStart?: number;
  selectionEnd?: number;
}

/** Сообщение с опциональным контекстом кода */
export interface ContextMessage extends ChatMessage {
  context?: CodeContext;
}

/** Оценка токенов: 4 символа на токен (грубая, но одинаковая везде) */
export function estimateTokens(text: string): number {
  return Math.ceil(text.length / 4);
}

/**
 * Блок контекста в том виде, в котором он уходит модели.
 * Формат важен: по нему модель понимает, где заканчивается вопрос и начинается файл.
 */
export function formatCodeContext(context?: CodeContext): string {
  if (!context?.content) {
    return '';
  }
  return `\n\n--- Файл: ${context.filePath} ---\n\`\`\`\n${context.content}\n\`\`\``;
}

/**
 * Системный промпт с автоинжектом правил проекта.
 * Формат совпадает с тем, что уходил модели раньше: разделитель и заголовок — часть контракта.
 */
export function systemPromptWithAgents(systemPrompt: string, agentsMd?: string): string {
  if (!agentsMd) {
    return systemPrompt;
  }
  return `${systemPrompt}\n\n## Правила проекта:\n${agentsMd}`;
}

export interface AssembleInput {
  /** Системный промпт из настроек */
  systemPrompt: string;
  /** Содержимое AGENTS.md, если найден */
  agentsMd?: string;
  /** История сессии, от старых к новым */
  messages: ContextMessage[];
  /** Бюджет контекста в токенах под систему + историю */
  maxTokens: number;
}

export interface AssembleResult {
  /** Готовый массив для отправки провайдеру: system + история */
  messages: ChatMessage[];
  /** Обрезанные сообщения (для суммаризации) */
  trimmed: ChatMessage[];
  /** Итоговый системный промпт (с AGENTS.md) */
  systemPrompt: string;
}

/**
 * Собрать сообщения для запроса: системный промпт + AGENTS.md + история с контекстом.
 *
 * Правила, которые нельзя менять молча:
 * - контекст кода учитывается в бюджете наравне с текстом сообщения;
 * - хотя бы одно последнее сообщение попадает в контекст, даже если оно не влезает —
 *   иначе запрос уйдёт вообще без вопроса;
 * - обрезанные сообщения возвращаются отдельно: их суммаризирует вызывающая сторона.
 */
export function assembleRequestMessages(input: AssembleInput): AssembleResult {
  const { maxTokens } = input;
  let systemPrompt = input.systemPrompt;

  if (input.agentsMd) {
    systemPrompt += `\n\n## Правила проекта:\n${input.agentsMd}`;
  }

  const systemMessage: ChatMessage = { role: 'system', content: systemPrompt };
  let usedTokens = estimateTokens(systemPrompt);

  const history: ChatMessage[] = [];
  const trimmed: ChatMessage[] = [];

  for (let i = input.messages.length - 1; i >= 0; i--) {
    const msg = input.messages[i];
    const contextStr = formatCodeContext(msg.context);
    const totalMsgTokens = estimateTokens(msg.content) + estimateTokens(contextStr);

    if (usedTokens + totalMsgTokens > maxTokens && history.length > 0) {
      for (let j = 0; j <= i; j++) {
        trimmed.push({
          role: input.messages[j].role,
          content: input.messages[j].content,
        });
      }
      break;
    }

    usedTokens += totalMsgTokens;
    history.unshift({
      role: msg.role,
      content: msg.content + contextStr,
    });
  }

  return { messages: [systemMessage, ...history], trimmed, systemPrompt };
}
