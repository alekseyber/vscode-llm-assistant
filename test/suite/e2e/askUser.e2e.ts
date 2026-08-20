// E2E: ask_user — уточняющие вопросы через реальный VS Code UI API.
// Стабы showQuickPick/showInformationMessage/showInputBox проверяют ветвление UI-инструмента.

import 'mocha';
import * as assert from 'assert';
import * as sinon from 'sinon';
import * as vscode from 'vscode';
import { createAskUserTool } from '../../../src/modes/chat/AskUserTool';

suite('E2E: ask_user', () => {
  let sandbox: sinon.SinonSandbox;

  setup(() => {
    sandbox = sinon.createSandbox();
  });

  teardown(() => {
    sandbox.restore();
  });

  test('3+ опций → showQuickPick, возвращает выбранный вариант', async () => {
    const qp = sandbox.stub(vscode.window, 'showQuickPick').resolves('sumArray' as any);

    const result = await createAskUserTool().execute({ question: 'Какое имя?', options: ['sum', 'sumArray', 'sumAll'] });

    assert.ok(qp.calledOnce, 'showQuickPick вызван');
    assert.ok(result.includes('sumArray'), 'возвращён выбранный вариант');
    assert.ok(result.includes('[ВОПРОС ЗАКРЫТ]'), 'ответ помечен как закрытый');
  });

  test('1-2 опции → showInformationMessage с кнопками', async () => {
    const im = sandbox.stub(vscode.window, 'showInformationMessage').resolves('Да' as any);

    const result = await createAskUserTool().execute({ question: 'Нужно ли добавить обработку ошибок?', options: ['Да', 'Нет'] });

    assert.ok(im.calledOnce, 'showInformationMessage вызван');
    assert.ok(result.includes('Да'));
  });

  test('без опций → showInputBox с открытым вводом', async () => {
    const ib = sandbox.stub(vscode.window, 'showInputBox').resolves('0.75' as any);

    const result = await createAskUserTool().execute({ question: 'Какой порог использовать?' });

    assert.ok(ib.calledOnce, 'showInputBox вызван');
    assert.ok(result.includes('0.75'));
  });

  test('Escape/закрытие → «(пропущено)»', async () => {
    sandbox.stub(vscode.window, 'showQuickPick').resolves(undefined as any);

    const result = await createAskUserTool().execute({ question: 'Какое имя?', options: ['a', 'b', 'c'] });

    assert.strictEqual(result, '(пропущено)');
  });

  test('пустой вопрос → ошибка, UI не вызывается', async () => {
    const qp = sandbox.stub(vscode.window, 'showQuickPick').resolves(undefined as any);
    const ib = sandbox.stub(vscode.window, 'showInputBox').resolves(undefined as any);

    const result = await createAskUserTool().execute({ question: '   ' });

    assert.ok(result.includes('Ошибка'), 'возвращена ошибка');
    assert.ok(qp.notCalled && ib.notCalled, 'UI не вызывался');
  });
});
