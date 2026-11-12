// Тесты для AskUserTool — уточняющие вопросы агента через VS Code UI

import 'mocha';
import * as assert from 'assert';
import { createAskUserTool } from '../../src/modes/chat/AskUserTool';
import { DialogStubs, stubDialogs } from '../support/vscode-harness';

suite('AskUserTool', () => {
  let dialogs: DialogStubs;

  teardown(() => {
    dialogs?.restore();
  });

  const F = (q: string, a: string) => `[ВОПРОС ЗАКРЫТ] ${q} — ответ: ${a}`;

  test('AC-1.1: 3+ опций показывает QuickPick и возвращает выбор', async () => {
    dialogs = stubDialogs({ quickPick: () => 'Вариант A' });
    const tool = createAskUserTool();
    const result = await tool.execute({
      question: 'Выберите вариант',
      options: ['Вариант A', 'Вариант B', 'Вариант C'],
    });
    assert.strictEqual(result, F('Выберите вариант', 'Вариант A'));
    assert.strictEqual(dialogs.calls.quickPick, 1, 'showQuickPick вызван один раз');
  });

  test('AC-1.1 (2 опции): модальное showInformationMessage с кнопками', async () => {
    dialogs = stubDialogs({ information: () => 'Да' });
    const tool = createAskUserTool();
    const result = await tool.execute({
      question: 'Продолжить?',
      options: ['Да', 'Нет'],
    });
    assert.strictEqual(result, F('Продолжить?', 'Да'));
  });

  test('AC-1.2: без options — InputBox с ignoreFocusOut, возвращает ввод', async () => {
    dialogs = stubDialogs({ inputBox: () => 'Пользовательский ответ' });
    const tool = createAskUserTool();
    const result = await tool.execute({ question: 'Как назвать файл?' });
    assert.strictEqual(result, F('Как назвать файл?', 'Пользовательский ответ'));
  });

  test('AC-1.3: Закрытие QuickPick (Escape) → "(пропущено)"', async () => {
    dialogs = stubDialogs({ quickPick: () => undefined });
    const tool = createAskUserTool();
    const result = await tool.execute({
      question: 'Выберите вариант',
      options: ['A', 'B', 'C'],
    });
    assert.strictEqual(result, '(пропущено)');
  });

  test('AC-1.3: Закрытие модального окна → "(пропущено)"', async () => {
    dialogs = stubDialogs({ information: () => undefined });
    const tool = createAskUserTool();
    const result = await tool.execute({ question: 'Продолжить?', options: ['Да', 'Нет'] });
    assert.strictEqual(result, '(пропущено)');
  });

  test('AC-1.3: Закрытие InputBox → "(пропущено)"', async () => {
    dialogs = stubDialogs({ inputBox: () => undefined });
    const tool = createAskUserTool();
    const result = await tool.execute({ question: 'Введите значение' });
    assert.strictEqual(result, '(пропущено)');
  });

  test('Авто-Да/Нет: вопрос с «нужно» без options → модальное окно с Да/Нет', async () => {
    dialogs = stubDialogs({ information: () => 'Да' });
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
