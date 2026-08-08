// AskUserTool — инструмент для уточняющих вопросов пользователю через VS Code UI
// Использует showInformationMessage (модальное окно в центре) вместо InputBox
// для гарантированной видимости пользователем

import * as vscode from 'vscode';
import { ChatTool } from './ChatAgentTools';

/**
 * Создаёт инструмент ask_user.
 *
 * Контракты:
 * - options передан (3+) → QuickPick (выпадающий список)
 * - options передан (1-2) → showInformationMessage с кнопками (модальное)
 * - options не передан → showInformationMessage с кнопкой «Ответить» → InputBox
 * - Escape/закрытие → "(пропущено)"
 * - Пустой question → ошибка
 */
export function createAskUserTool(): ChatTool {
  return {
    name: 'ask_user',
    description:
      'Задать уточняющий вопрос пользователю. ' +
      'Если пользователь явно назвал варианты — передай их в options. ' +
      'Если пользователь НЕ дал вариантов — НЕ передавай options (оставь пустым), откроется поле ввода. ' +
      'Пример с вариантами: question="Какое имя?", options=["sum", "sumArray"]. ' +
      'Пример без вариантов: question="Какой порог использовать?" (без options). ' +
      'НЕ ПРИДУМЫВАЙ варианты сам — если пользователь их не дал, не передавай options!',
    parameters: {
      type: 'object',
      properties: {
        question: { type: 'string', description: 'Текст вопроса' },
        options: {
          type: 'array',
          items: { type: 'string' },
          description: 'Варианты ответа. ВСЕГДА передавай массив строк! 2 варианта — кнопки Да/Нет.',
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
        // 3+ опций → QuickPick (богатый выбор)
        if (options.length >= 3) {
          const result = await vscode.window.showQuickPick(options, {
            placeHolder: question,
            canPickMany: false,
          });
          return result ?? '(пропущено)';
        }

        // 1-2 опции → showInformationMessage с кнопками (модальное, заметное)
        const result = await vscode.window.showInformationMessage(
          question,
          { modal: true },
          ...options,
        );
        return result ?? '(пропущено)';
      }

      // Без опций: InputBox напрямую (без промежуточной модалки — коллизия UI)
      const result = await vscode.window.showInputBox({
        prompt: question,
        placeHolder: 'Ваш ответ...',
        ignoreFocusOut: true,
      });
      return result ?? '(пропущено)';
    },
  };
}
