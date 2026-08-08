// Тесты для AskUserTool — уточняющие вопросы агента через VS Code UI

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

  const F = (q: string, a: string) => `[ВОПРОС ЗАКРЫТ] ${q} — ответ: ${a}`;

  test('AC-1.1: 3+ опций показывает QuickPick и возвращает выбор', async () => {
    (sandbox.stub(vscode.window, 'showQuickPick') as any).resolves('Вариант A');
    const tool = createAskUserTool();
    const result = await tool.execute({
      question: 'Выберите вариант',
      options: ['Вариант A', 'Вариант B', 'Вариант C'],
    });
    assert.strictEqual(result, F('Выберите вариант', 'Вариант A'));
  });

  test('AC-1.1 (2 опции): модальное showInformationMessage с кнопками', async () => {
    (sandbox.stub(vscode.window, 'showInformationMessage') as any).resolves('Да');
    const tool = createAskUserTool();
    const result = await tool.execute({
      question: 'Продолжить?',
      options: ['Да', 'Нет'],
    });
    assert.strictEqual(result, F('Продолжить?', 'Да'));
  });

  test('AC-1.2: без options — InputBox с ignoreFocusOut, возвращает ввод', async () => {
    (sandbox.stub(vscode.window, 'showInputBox') as any).resolves('Пользовательский ответ');
    const tool = createAskUserTool();
    const result = await tool.execute({ question: 'Как назвать файл?' });
    assert.strictEqual(result, F('Как назвать файл?', 'Пользовательский ответ'));
  });

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
    const result = await tool.execute({ question: 'Продолжить?', options: ['Да', 'Нет'] });
    assert.strictEqual(result, '(пропущено)');
  });

  test('AC-1.3: Закрытие InputBox → "(пропущено)"', async () => {
    (sandbox.stub(vscode.window, 'showInputBox') as any).resolves(undefined);
    const tool = createAskUserTool();
    const result = await tool.execute({ question: 'Введите значение' });
    assert.strictEqual(result, '(пропущено)');
  });

  test('Авто-Да/Нет: вопрос с «нужно» без options → модальное окно с Да/Нет', async () => {
    (sandbox.stub(vscode.window, 'showInformationMessage') as any).resolves('Да');
    const tool = createAskUserTool();
    const result = await tool.execute({ question: 'Нужно ли добавить обработку ошибок?' });
    assert.strictEqual(result, F('Нужно ли добавить обработку ошибок?', 'Да'));
  });

  test('AC-1.4: Пустой question возвращает ошибку', async () => {
    const tool = createAskUserTool();
    const result = await tool.execute({ question: '', options: ['A', 'B'] });
    assert.ok(result.startsWith('Ошибка:'));
  });

  test('AC-1.4: Отсутствующий question возвращает ошибку', async () => {
    const tool = createAskUserTool();
    const result = await tool.execute({});
    assert.ok(result.startsWith('Ошибка:'));
  });

  test('AC-1.5: ask_user присутствует в схеме инструмента', () => {
    const tool = createAskUserTool();
    assert.strictEqual(tool.name, 'ask_user');
    assert.ok(tool.description.includes('НЕ ПРИДУМЫВАЙ'), 'Должен быть запрет на придумывание вариантов');
    assert.ok(tool.parameters, 'Параметры должны быть');
  });
});
