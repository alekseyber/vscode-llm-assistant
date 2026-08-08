// Тесты для AskUserTool — уточняющие вопросы агента через VS Code UI
// AC-1.1..AC-1.5: QuickPick, InformationMessage, Escape, пустой question

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

  // ── AC-1.1: 3+ опций → QuickPick ──

  test('AC-1.1: 3+ опций показывает QuickPick и возвращает выбор', async () => {
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

  // ── AC-1.1 (1-2 опции): showInformationMessage с модальным окном ──

  test('AC-1.1 (2 опции): модальное showInformationMessage с кнопками', async () => {
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
      { modal: true },
      'Да',
      'Нет',
    );
  });

  test('AC-1.1 (1 опция): модальное окно с одной кнопкой', async () => {
    (sandbox.stub(vscode.window, 'showInformationMessage') as any).resolves('OK');

    const tool = createAskUserTool();
    const result = await tool.execute({
      question: 'Нажми OK',
      options: ['OK'],
    });

    assert.strictEqual(result, 'OK');
  });

  // ── AC-1.2: без options → модальное окно → кнопка «Ответить» → InputBox ──

  test('AC-1.2: без options — модальное окно → Ответить → InputBox', async () => {
    (sandbox.stub(vscode.window, 'showInformationMessage') as any).resolves('Ответить');
    (sandbox.stub(vscode.window, 'showInputBox') as any).resolves('Пользовательский ответ');

    const tool = createAskUserTool();
    const result = await tool.execute({
      question: 'Как назвать файл?',
    });

    assert.strictEqual(result, 'Пользовательский ответ');
    sinon.assert.calledOnce(vscode.window.showInformationMessage as sinon.SinonStub);
    sinon.assert.calledOnce(vscode.window.showInputBox as sinon.SinonStub);
  });

  test('AC-1.2: без options — нажал Пропустить → "(пропущено)"', async () => {
    (sandbox.stub(vscode.window, 'showInformationMessage') as any).resolves('Пропустить');
    (sandbox.stub(vscode.window, 'showInputBox') as any).resolves('не должен вызываться');

    const tool = createAskUserTool();
    const result = await tool.execute({
      question: 'Как назвать файл?',
    });

    assert.strictEqual(result, '(пропущено)');
    // InputBox не должен вызываться при нажатии «Пропустить»
    sinon.assert.notCalled(vscode.window.showInputBox as sinon.SinonStub);
  });

  // ── AC-1.3: Escape/закрытие ──

  test('AC-1.3: Закрытие QuickPick (Escape) → "(пропущено)"', async () => {
    (sandbox.stub(vscode.window, 'showQuickPick') as any).resolves(undefined);

    const tool = createAskUserTool();
    const result = await tool.execute({
      question: 'Выберите вариант',
      options: ['A', 'B', 'C'],
    });

    assert.strictEqual(result, '(пропущено)');
  });

  test('AC-1.3: Закрытие модального окна → "(пропущено)"', async () => {
    (sandbox.stub(vscode.window, 'showInformationMessage') as any).resolves(undefined);

    const tool = createAskUserTool();
    const result = await tool.execute({
      question: 'Продолжить?',
      options: ['Да', 'Нет'],
    });

    assert.strictEqual(result, '(пропущено)');
  });

  test('AC-1.3: Закрытие модального окна без options → "(пропущено)"', async () => {
    (sandbox.stub(vscode.window, 'showInformationMessage') as any).resolves(undefined);

    const tool = createAskUserTool();
    const result = await tool.execute({
      question: 'Введите значение',
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
    const result = await tool.execute({});

    assert.ok(result.startsWith('Ошибка:'), 'Должно быть сообщение об ошибке');
  });

  // ── AC-1.5: инструмент доступен в схеме ──

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
