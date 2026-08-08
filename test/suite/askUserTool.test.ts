// Тесты для AskUserTool — уточняющие вопросы агента через VS Code UI
// AC-1.1..AC-1.5: QuickPick, InputBox, showInformationMessage, Escape, пустой question

import 'mocha';
import * as sinon from 'sinon';
import * as vscode from 'vscode';
import * as assert from 'assert';
import { createAskUserTool } from '../../src/modes/chat/AskUserTool';

suite('AskUserTool', () => {
  let sandbox: sinon.SinonSandbox;

  setup(() => {
    sandbox = sinon.createSandbox();
  });

  teardown(() => {
    sandbox.restore();
  });

  // ── AC-1.1: options передан (не 2) → showQuickPick, возвращает выбор ──

  test('AC-1.1: ask_user с options показывает QuickPick и возвращает выбор', async () => {
    (sandbox.stub(vscode.window, 'showQuickPick') as any).resolves('Вариант A');

    const tool = createAskUserTool();
    const result = await tool.execute({
      question: 'Выберите вариант',
      options: ['Вариант A', 'Вариант B', 'Вариант C'],
    });

    assert.strictEqual(result, 'Вариант A');
    sinon.assert.calledOnce(vscode.window.showQuickPick as sinon.SinonStub);
    sinon.assert.calledWith(
      vscode.window.showQuickPick as sinon.SinonStub,
      ['Вариант A', 'Вариант B', 'Вариант C'],
      { placeHolder: 'Выберите вариант', canPickMany: false },
    );
  });

  // ── AC-1.1 (2 опции): showInformationMessage с кнопками ──

  test('AC-1.1 (2 опции): ask_user с 2 опциями показывает showInformationMessage с кнопками', async () => {
    (sandbox.stub(vscode.window, 'showInformationMessage') as any).resolves('Да');

    const tool = createAskUserTool();
    const result = await tool.execute({
      question: 'Продолжить?',
      options: ['Да', 'Нет'],
    });

    assert.strictEqual(result, 'Да');
    sinon.assert.calledOnce(vscode.window.showInformationMessage as sinon.SinonStub);
    sinon.assert.calledWith(
      vscode.window.showInformationMessage as sinon.SinonStub,
      'Продолжить?',
      { modal: false },
      'Да',
      'Нет',
    );
  });

  // ── AC-1.2: options не передан → InputBox, возвращает ввод ──

  test('AC-1.2: ask_user без options показывает InputBox и возвращает ввод', async () => {
    (sandbox.stub(vscode.window, 'showInputBox') as any).resolves('Пользовательский ответ');

    const tool = createAskUserTool();
    const result = await tool.execute({
      question: 'Как назвать файл?',
    });

    assert.strictEqual(result, 'Пользовательский ответ');
    sinon.assert.calledOnce(vscode.window.showInputBox as sinon.SinonStub);
    sinon.assert.calledWith(vscode.window.showInputBox as sinon.SinonStub, {
      prompt: 'Как назвать файл?',
      placeHolder: 'Ваш ответ...',
    });
  });

  // ── AC-1.3: Escape/закрытие → "(пропущено)" ──

  test('AC-1.3: Закрытие QuickPick (Escape) возвращает "(пропущено)"', async () => {
    (sandbox.stub(vscode.window, 'showQuickPick') as any).resolves(undefined); // пользователь закрыл

    const tool = createAskUserTool();
    const result = await tool.execute({
      question: 'Выберите вариант',
      options: ['A', 'B'],
    });

    assert.strictEqual(result, '(пропущено)');
  });

  test('AC-1.3: Закрытие InputBox (Escape) возвращает "(пропущено)"', async () => {
    (sandbox.stub(vscode.window, 'showInputBox') as any).resolves(undefined);

    const tool = createAskUserTool();
    const result = await tool.execute({
      question: 'Введите значение',
    });

    assert.strictEqual(result, '(пропущено)');
  });

  test('AC-1.3: Закрытие showInformationMessage возвращает "(пропущено)"', async () => {
    (sandbox.stub(vscode.window, 'showInformationMessage') as any).resolves(undefined);

    const tool = createAskUserTool();
    const result = await tool.execute({
      question: 'Продолжить?',
      options: ['Да', 'Нет'],
    });

    assert.strictEqual(result, '(пропущено)');
  });

  // ── AC-1.4: Пустой question → ошибка ──

  test('AC-1.4: Пустой question возвращает ошибку', async () => {
    const tool = createAskUserTool();
    const result = await tool.execute({
      question: '',
      options: ['A', 'B'],
    });

    assert.ok(result.startsWith('Ошибка:'), 'Должно быть сообщение об ошибке');
    assert.ok(
      result.includes('вопрос обязателен'),
      'Должно быть указание на обязательность вопроса',
    );
  });

  test('AC-1.4: Отсутствующий question возвращает ошибку', async () => {
    const tool = createAskUserTool();
    const result = await tool.execute({
      // question не передан
    });

    assert.ok(result.startsWith('Ошибка:'), 'Должно быть сообщение об ошибке');
  });

  // ── AC-1.5: инструмент доступен в схеме (проверяется через имя/параметры) ──

  test('AC-1.5: ask_user присутствует в схеме инструмента', () => {
    const tool = createAskUserTool();

    assert.strictEqual(tool.name, 'ask_user');
    assert.ok(tool.description, 'Описание должно быть');
    assert.ok(tool.parameters, 'Параметры должны быть');

    const params = tool.parameters as any;
    assert.ok(params.properties.question, 'question должен быть в параметрах');
    assert.ok(params.properties.options, 'options должны быть в параметрах');
    assert.deepStrictEqual(params.required, ['question'], 'question обязателен');
  });
});
