// E2E: ask_user — уточняющие вопросы через реальный VS Code UI API.
// Стабы showQuickPick/showInformationMessage/showInputBox проверяют ветвление UI-инструмента.

import 'mocha';
import * as assert from 'assert';
import { createAskUserTool } from '../../../src/modes/chat/AskUserTool';
import { DialogStubs, stubDialogs } from '../../support/vscode-harness';

suite('E2E: ask_user', () => {
  let dialogs: DialogStubs | undefined;

  teardown(() => {
    dialogs?.restore();
    dialogs = undefined;
  });

  test('3+ опций → showQuickPick, возвращает выбранный вариант', async () => {
    dialogs = stubDialogs({ quickPick: () => 'sumArray' });

    const result = await createAskUserTool().execute({ question: 'Какое имя?', options: ['sum', 'sumArray', 'sumAll'] });

    assert.strictEqual(dialogs.calls.quickPick, 1, 'showQuickPick вызван');
    assert.ok(result.includes('sumArray'), 'возвращён выбранный вариант');
    assert.ok(result.includes('[ВОПРОС ЗАКРЫТ]'), 'ответ помечен как закрытый');
  });

  test('1-2 опции → showInformationMessage с кнопками', async () => {
    dialogs = stubDialogs({ information: () => 'Да' });

    const result = await createAskUserTool().execute({ question: 'Нужно ли добавить обработку ошибок?', options: ['Да', 'Нет'] });

    assert.strictEqual(dialogs.calls.information, 1, 'showInformationMessage вызван');
    assert.ok(result.includes('Да'));
  });

  test('без опций → showInputBox с открытым вводом', async () => {
    dialogs = stubDialogs({ inputBox: () => '0.75' });

    const result = await createAskUserTool().execute({ question: 'Какой порог использовать?' });

    assert.strictEqual(dialogs.calls.inputBox, 1, 'showInputBox вызван');
    assert.ok(result.includes('0.75'));
  });

  test('Escape/закрытие → «(пропущено)»', async () => {
    dialogs = stubDialogs({ quickPick: () => undefined });

    const result = await createAskUserTool().execute({ question: 'Какое имя?', options: ['a', 'b', 'c'] });

    assert.strictEqual(result, '(пропущено)');
  });

  test('пустой вопрос → ошибка, UI не вызывается', async () => {
    dialogs = stubDialogs({ quickPick: () => undefined, inputBox: () => undefined });

    const result = await createAskUserTool().execute({ question: '   ' });

    assert.ok(result.includes('Ошибка'), 'возвращена ошибка');
    assert.ok(
      dialogs.calls.quickPick === 0 && dialogs.calls.inputBox === 0,
      'UI не вызывался',
    );
  });
});
