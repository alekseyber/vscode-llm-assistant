// AskUserTool — инструмент для уточняющих вопросов пользователю через VS Code UI
// QuickPick / InputBox / showInformationMessage в зависимости от переданных options

import * as vscode from 'vscode';
import { ChatTool } from './ChatAgentTools';

/**
 * Создаёт инструмент ask_user.
 *
 * Контракты:
 * - options передан (1+ вариант) → showQuickPick
 * - options.length === 2 → showInformationMessage с кнопками
 * - options не передан → showInputBox
 * - Escape/закрытие → "(пропущено)"
 * - Пустой question → ошибка
 */
export function createAskUserTool(): ChatTool {
  return {
    name: 'ask_user',
    description:
      'Задать уточняющий вопрос пользователю. Используй когда не хватает контекста или нужен выбор.',
    parameters: {
      type: 'object',
      properties: {
        question: { type: 'string', description: 'Текст вопроса' },
        options: {
          type: 'array',
          items: { type: 'string' },
          description: 'Варианты ответа (опционально). Если 2 — да/нет кнопки.',
        },
      },
      required: ['question'],
    },

    async execute(args: Record<string, unknown>): Promise<string> {
      const question = (args.question as string | undefined) || '';

      // AC-1.4: Пустой question → ошибка
      if (question.trim() === '') {
        return 'Ошибка: вопрос обязателен для ask_user';
      }

      const options = args.options as string[] | undefined;

      // С опциями
      if (options && options.length > 0) {
        // Ровно 2 опции → showInformationMessage с кнопками «Да» / «Нет»
        if (options.length === 2) {
          const result = await vscode.window.showInformationMessage(
            question,
            { modal: false },
            options[0],
            options[1],
          );
          // AC-1.3: Escape/закрытие → "(пропущено)"
          return result ?? '(пропущено)';
        }

        // AC-1.1: QuickPick с вариантами
        const result = await vscode.window.showQuickPick(options, {
          placeHolder: question,
          canPickMany: false,
        });
        return result ?? '(пропущено)';
      }

      // AC-1.2: InputBox с открытым вводом
      const result = await vscode.window.showInputBox({
        prompt: question,
        placeHolder: 'Ваш ответ...',
      });
      return result ?? '(пропущено)';
    },
  };
}
