// Тесты для ConversationManager — управление историей сообщений
// Проверяет: добавление сообщений, сохранение/восстановление через Memento,
// прикрепление контекста кода, ограничение по токенам, лимит сообщений

import 'mocha';
import * as sinon from 'sinon';
import * as vscode from 'vscode';
import * as assert from 'assert';
import { ConversationManager, ContextMessage, CodeContext } from '../../src/modes/chat/ConversationManager';

suite('ConversationManager', () => {
  let sandbox: sinon.SinonSandbox;
  let storage: sinon.SinonStubbedInstance<vscode.Memento>;
  let manager: ConversationManager;

  setup(() => {
    sandbox = sinon.createSandbox();

    // Создаём mock Memento (workspaceState)
    storage = {
      get: sandbox.stub(),
      update: sandbox.stub(),
      keys: sandbox.stub().returns([]),
      setKeysForSync: sandbox.stub(),
    } as any;

    // По умолчанию storage.get возвращает пустой массив
    storage.get.withArgs('llmAssistant.chat.history', []).returns([]);

    // Мокаем vscode.workspace.getConfiguration для getMessagesForRequest
    const mockConfig = {
      get: sandbox.fake((key: string, defaultValue?: unknown) => {
        if (key === 'chat.maxContextTokens') return 4096;
        return defaultValue;
      }),
      has: sandbox.fake(() => false),
      inspect: sandbox.fake(() => undefined),
      update: sandbox.fake(() => Promise.resolve()),
    };
    sandbox.stub(vscode.workspace, 'getConfiguration').returns(mockConfig as any);

    // Создаём менеджер с mock-хранилищем
    manager = new ConversationManager(storage);
  });

  teardown(() => {
    sandbox.restore();
  });

  /**
   * Создаёт тестовое сообщение.
   */
  function createMessage(
    role: 'system' | 'user' | 'assistant',
    content: string,
    context?: CodeContext
  ): ContextMessage {
    const msg: ContextMessage = { role, content };
    if (context) msg.context = context;
    return msg;
  }

  test('addMessage() добавляет сообщение в историю', () => {
    const msg = createMessage('user', 'Привет, как дела?');
    manager.addMessage(msg);

    const messages = manager.getMessages();
    assert.strictEqual(messages.length, 1);
    assert.strictEqual(messages[0].content, 'Привет, как дела?');
  });

  test('addMessage() вызывает save() (Memento.update)', () => {
    const msg = createMessage('user', 'test');
    manager.addMessage(msg);

    assert.ok(storage.update.calledOnce, 'save() должен быть вызван после добавления');
    assert.ok(
      storage.update.calledWith('llmAssistant.chat.history'),
      'Должен быть правильный ключ хранилища'
    );
  });

  test('getMessages() возвращает копию массива', () => {
    const msg = createMessage('user', 'test');
    manager.addMessage(msg);

    const messages = manager.getMessages();
    messages.push(createMessage('assistant', 'modified'));

    // Оригинал не должен измениться
    const original = manager.getMessages();
    assert.strictEqual(original.length, 1, 'Оригинальный массив не должен измениться');
  });

  test('clearHistory() очищает все сообщения', () => {
    manager.addMessage(createMessage('user', 'msg1'));
    manager.addMessage(createMessage('assistant', 'response1'));
    manager.addMessage(createMessage('user', 'msg2'));

    assert.strictEqual(manager.getMessages().length, 3);

    manager.clearHistory();
    assert.strictEqual(manager.getMessages().length, 0, 'После очистки история должна быть пуста');
  });

  test('clearHistory() вызывает save()', () => {
    storage.update.resetHistory();
    manager.clearHistory();

    assert.ok(storage.update.called, 'save() должен быть вызван при очистке');
  });

  test('attachCodeContext() добавляет контекст к последнему user-сообщению', () => {
    manager.addMessage(createMessage('user', 'Что делает этот код?'));
    manager.addMessage(createMessage('assistant', 'Давай посмотрим.'));

    const codeContext: CodeContext = {
      filePath: '/test/file.ts',
      content: 'const x = 1;',
      selectionStart: 1,
      selectionEnd: 3,
    };

    manager.attachCodeContext(codeContext);

    const messages = manager.getMessages();
    // Контекст должен быть прикреплён к первому (последнему user) сообщению
    assert.ok(messages[0].context, 'Контекст должен быть прикреплён');
    assert.strictEqual(messages[0].context!.filePath, '/test/file.ts');
    assert.strictEqual(messages[0].context!.content, 'const x = 1;');
  });

  test('attachCodeContext() не изменяет assistant-сообщения', () => {
    manager.addMessage(createMessage('assistant', 'Ответ'));
    manager.addMessage(createMessage('user', 'Вопрос'));

    const codeContext: CodeContext = {
      filePath: '/test/file.ts',
      content: 'test',
    };

    manager.attachCodeContext(codeContext);

    const messages = manager.getMessages();
    // Контекст должен быть на user-сообщении, не на assistant
    assert.strictEqual(messages[1].role, 'user');
    assert.ok(messages[1].context);
    assert.strictEqual(messages[0].context, undefined, 'Assistant сообщение не должно иметь контекста');
  });

  test('getMessagesForRequest() возвращает последние сообщения в лимите токенов', async () => {
    // Добавляем несколько сообщений
    manager.addMessage(createMessage('user', 'Первое сообщение'));
    manager.addMessage(createMessage('assistant', 'Первый ответ'));
    manager.addMessage(createMessage('user', 'Второй вопрос'));
    manager.addMessage(createMessage('assistant', 'Второй ответ'));
    manager.addMessage(createMessage('user', 'Третий запрос'));

    const messages = await manager.getMessagesForRequest();

    // Должны быть system message + 5 сообщений = 6
    assert.strictEqual(messages.length, 6);
    assert.strictEqual(messages[1].content, 'Первое сообщение');
    assert.strictEqual(messages[5].content, 'Третий запрос');
  });

  test('constructor() загружает сохранённую историю из хранилища', () => {
    const savedMessages: ContextMessage[] = [
      createMessage('user', 'Сохранённый вопрос'),
      createMessage('assistant', 'Сохранённый ответ'),
    ];

    // Возвращаем сохранённые сообщения при загрузке
    storage.get.withArgs('llmAssistant.chat.history', []).returns(savedMessages);

    // Создаём новый менеджер — он должен загрузить историю
    const restoredManager = new ConversationManager(storage);
    const messages = restoredManager.getMessages();

    assert.strictEqual(messages.length, 2, 'Должна загрузиться сохранённая история');
    assert.strictEqual(messages[0].content, 'Сохранённый вопрос');
    assert.strictEqual(messages[1].content, 'Сохранённый ответ');
  });

  test('constructor() начинает с пустой историей если нет сохранённых данных', () => {
    // storage.get уже настроен возвращать []
    const freshManager = new ConversationManager(storage);
    const messages = freshManager.getMessages();

    assert.strictEqual(messages.length, 0);
  });

  test('addMessage() ограничивает количество сообщений (максимум 100)', () => {
    // Добавляем 105 сообщений
    for (let i = 0; i < 105; i++) {
      manager.addMessage(createMessage('user', `Сообщение ${i}`));
    }

    const messages = manager.getMessages();
    assert.strictEqual(messages.length, 100, 'Должно быть не более 100 сообщений');
    // Проверяем, что остались последние 100
    assert.strictEqual(messages[0].content, 'Сообщение 5');
    assert.strictEqual(messages[99].content, 'Сообщение 104');
  });

  test('getMessagesForRequest() учитывает контекст кода в оценке токенов', async () => {
    // Создаём сообщение с большим контекстом кода
    const largeCodeContext: CodeContext = {
      filePath: '/test/large.ts',
      content: 'x'.repeat(10000), // ~2500 токенов
    };

    manager.addMessage(createMessage('user', 'Что делает этот код?', largeCodeContext));
    manager.addMessage(createMessage('assistant', 'Этот код делает многое.'));

    // Мокаем маленький лимит токенов для проверки обрезания
    const mockConfig = {
      get: sandbox.fake((key: string, defaultValue?: unknown) => {
        if (key === 'chat.maxContextTokens') return 100; // Очень маленький лимит
        return defaultValue;
      }),
      has: sandbox.fake(() => false),
      inspect: sandbox.fake(() => undefined),
      update: sandbox.fake(() => Promise.resolve()),
    };
    (vscode.workspace.getConfiguration as sinon.SinonStub).returns(mockConfig as any);

    // Второй менеджер с новым лимитом
    const manager2 = new ConversationManager(storage);
    manager2.addMessage(createMessage('user', 'Что делает этот код?', largeCodeContext));
    manager2.addMessage(createMessage('assistant', 'Короткий ответ.'));

    const messages = await manager2.getMessagesForRequest();

    // Должно быть только последнее сообщение, т.к. контекст кода большой
    assert.strictEqual(messages.length, 1, 'Должно остаться только последнее сообщение');
    assert.strictEqual(messages[0].role, 'assistant');
  });
});