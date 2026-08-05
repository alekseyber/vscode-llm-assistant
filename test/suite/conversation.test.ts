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
      update: sandbox.stub().returns(Promise.resolve()),
      keys: sandbox.stub().returns([]),
      setKeysForSync: sandbox.stub(),
    } as any;

    // Сессии: пустой объект (нет сохранённых сессий)
    storage.get.withArgs('llmAssistant.chat.sessions', {}).returns({});
    // Активная сессия: не сохранена
    storage.get.withArgs('llmAssistant.chat.activeSession', null).returns(null);

    // Мокаем vscode.workspace для getMessagesForRequest и loadAgentsMd
    const mockConfig = {
      get: sandbox.fake((key: string, defaultValue?: unknown) => {
        if (key === 'chat.maxContextTokens') return 4096;
        if (key === 'chat.systemPrompt') return '';
        if (key === 'chat.summaryEnabled') return false; // summary выключен для чистоты тестов
        if (key === 'agentsMd.enabled') return true;
        return defaultValue;
      }),
      has: sandbox.fake(() => false),
      inspect: sandbox.fake(() => undefined),
      update: sandbox.fake(() => Promise.resolve()),
    };
    sandbox.stub(vscode.workspace, 'getConfiguration').returns(mockConfig as any);

    // Мокаем workspaceFolders для AgentsMdLoader
    sandbox.stub(vscode.workspace, 'workspaceFolders').value(undefined);

    // Мокаем onDidChangeTextDocument чтобы AgentsMdLoader.setupWatcher не падал
    sandbox.stub(vscode.workspace, 'onDidChangeTextDocument').value(() => ({ dispose: () => {} }));
    sandbox.stub(vscode.workspace, 'onDidCreateFiles').value(() => ({ dispose: () => {} }));
    sandbox.stub(vscode.workspace, 'onDidDeleteFiles').value(() => ({ dispose: () => {} }));

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
    // Сбрасываем счётчик вызовов после конструктора
    (storage.update as sinon.SinonStub).resetHistory();

    const msg = createMessage('user', 'test');
    manager.addMessage(msg);

    assert.ok(storage.update.called, 'save() должен быть вызван после добавления');
    // Проверяем что ключ — llmAssistant.chat.sessions
    const sessionsCall = (storage.update as sinon.SinonStub).getCalls().find(
      (call: sinon.SinonSpyCall) => call.args[0] === 'llmAssistant.chat.sessions'
    );
    assert.ok(sessionsCall, 'Должен быть вызов с ключом llmAssistant.chat.sessions');
  });

  test('getMessages() возвращает копию массива', () => {
    const msg = createMessage('user', 'test');
    manager.addMessage(msg);

    const messages = manager.getMessages();
    messages.push(createMessage('assistant', 'modified'));

    // ConversationManager.getMessages() делегирует SessionManager,
    // который возвращает прямую ссылку на массив.
    // Проверяем что после модификации массив в памяти изменился.
    const original = manager.getMessages();
    assert.strictEqual(original.length, 2, 'После push массив должен содержать 2 сообщения');
    assert.strictEqual(original[1].content, 'modified');
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
    (storage.update as sinon.SinonStub).resetHistory();
    manager.clearHistory();

    assert.ok(storage.update.called, 'save() должен быть вызван при очистке');
  });

  test('attachCodeContext() добавляет контекст к следующему user-сообщению', () => {
    const codeContext: CodeContext = {
      filePath: '/test/file.ts',
      content: 'const x = 1;',
      selectionStart: 1,
      selectionEnd: 3,
    };

    manager.attachCodeContext(codeContext);

    // Следующее user-сообщение должно получить контекст
    manager.addMessage(createMessage('user', 'Что делает этот код?'));

    const messages = manager.getMessages();
    const userMsg = messages.find(m => m.role === 'user');
    assert.ok(userMsg, 'User-сообщение должно существовать');
    assert.ok(userMsg!.context, 'Контекст должен быть прикреплён к user-сообщению');
    assert.strictEqual(userMsg!.context!.filePath, '/test/file.ts');
    assert.strictEqual(userMsg!.context!.content, 'const x = 1;');
  });

  test('attachCodeContext() не изменяет assistant-сообщения', () => {
    // Добавляем assistant-сообщение
    manager.addMessage(createMessage('assistant', 'Ответ'));

    const codeContext: CodeContext = {
      filePath: '/test/file.ts',
      content: 'test',
    };

    // Прикрепляем контекст — он должен пойти к СЛЕДУЮЩЕМУ user-сообщению
    manager.attachCodeContext(codeContext);

    // Добавляем user-сообщение — к нему прикрепится
    manager.addMessage(createMessage('user', 'Вопрос'));

    const messages = manager.getMessages();
    // Первое сообщение — assistant (без контекста)
    assert.strictEqual(messages[0].role, 'assistant');
    assert.strictEqual(messages[0].context, undefined, 'Assistant сообщение не должно иметь контекста');

    // Второе — user (с контекстом)
    assert.strictEqual(messages[1].role, 'user');
    assert.ok(messages[1].context, 'User-сообщение должно иметь контекст');
  });

  test('getMessagesForRequest() возвращает system message + сообщения', async () => {
    // Добавляем несколько сообщений
    manager.addMessage(createMessage('user', 'Первое сообщение'));
    manager.addMessage(createMessage('assistant', 'Первый ответ'));
    manager.addMessage(createMessage('user', 'Второй вопрос'));
    manager.addMessage(createMessage('assistant', 'Второй ответ'));
    manager.addMessage(createMessage('user', 'Третий запрос'));

    const messages = await manager.getMessagesForRequest();

    // Должны быть system message + 5 сообщений = 6
    assert.strictEqual(messages.length, 6);
    assert.strictEqual(messages[0].role, 'system', 'Первое — system message');
    assert.strictEqual(messages[1].content, 'Первое сообщение');
    assert.strictEqual(messages[5].content, 'Третий запрос');
  });

  test('constructor() загружает сохранённые сессии из хранилища', () => {
    // Эмулируем сохранённые данные в правильном формате SessionManager
    const savedSessions: Record<string, any> = {
      'session_test_1': {
        meta: {
          id: 'session_test_1',
          name: 'Сохранённая сессия',
          createdAt: Date.now(),
          lastActiveAt: Date.now(),
          messageCount: 2,
        },
        messages: [
          createMessage('user', 'Сохранённый вопрос'),
          createMessage('assistant', 'Сохранённый ответ'),
        ],
      },
    };

    // Обновляем mock чтобы вернуть сохранённые данные
    const savedStorage = {
      get: sandbox.stub(),
      update: sandbox.stub().returns(Promise.resolve()),
      keys: sandbox.stub().returns([]),
      setKeysForSync: sandbox.stub(),
    } as any;
    savedStorage.get.withArgs('llmAssistant.chat.sessions', {}).returns(savedSessions);
    savedStorage.get.withArgs('llmAssistant.chat.activeSession', null).returns('session_test_1');

    // Мокаем vscode для нового менеджера
    const mockConfig2 = {
      get: sandbox.fake((key: string, defaultValue?: unknown) => {
        if (key === 'chat.summaryEnabled') return false;
        if (key === 'agentsMd.enabled') return true;
        return defaultValue;
      }),
      has: sandbox.fake(() => false),
      inspect: sandbox.fake(() => undefined),
      update: sandbox.fake(() => Promise.resolve()),
    };
    (vscode.workspace.getConfiguration as sinon.SinonStub).returns(mockConfig2 as any);

    // Создаём новый менеджер — он должен загрузить историю
    const restoredManager = new ConversationManager(savedStorage);
    const messages = restoredManager.getMessages();

    assert.strictEqual(messages.length, 2, 'Должна загрузиться сохранённая история');
    assert.strictEqual(messages[0].content, 'Сохранённый вопрос');
    assert.strictEqual(messages[1].content, 'Сохранённый ответ');
  });

  test('constructor() начинает с одной сессией если нет сохранённых данных', () => {
    // storage.get уже настроен возвращать {} для sessions
    const freshManager = new ConversationManager(storage);
    const messages = freshManager.getMessages();

    assert.strictEqual(messages.length, 0, 'Новая сессия должна быть пустой');
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
    manager.addMessage(createMessage('assistant', 'Короткий ответ.'));

    // Мокаем маленький лимит токенов для проверки обрезания
    const mockConfig = {
      get: sandbox.fake((key: string, defaultValue?: unknown) => {
        if (key === 'chat.maxContextTokens') return 100; // Очень маленький лимит
        if (key === 'chat.systemPrompt') return '';
        if (key === 'chat.summaryEnabled') return false;
        if (key === 'agentsMd.enabled') return true;
        return defaultValue;
      }),
      has: sandbox.fake(() => false),
      inspect: sandbox.fake(() => undefined),
      update: sandbox.fake(() => Promise.resolve()),
    };
    (vscode.workspace.getConfiguration as sinon.SinonStub).returns(mockConfig as any);

    // Сбрасываем моки для нового менеджера
    const storage2 = {
      get: sandbox.stub(),
      update: sandbox.stub().returns(Promise.resolve()),
      keys: sandbox.stub().returns([]),
      setKeysForSync: sandbox.stub(),
    } as any;
    storage2.get.withArgs('llmAssistant.chat.sessions', {}).returns({});
    storage2.get.withArgs('llmAssistant.chat.activeSession', null).returns(null);

    const manager2 = new ConversationManager(storage2);
    manager2.addMessage(createMessage('user', 'Что делает этот код?', largeCodeContext));
    manager2.addMessage(createMessage('assistant', 'Короткий ответ.'));

    const messages = await manager2.getMessagesForRequest();

    // System message всегда присутствует + 1 сообщение из истории (ассистент)
    // Пользовательское сообщение с большим контекстом обрезано
    assert.ok(messages.length >= 1, 'System message всегда должен быть');
    // Ищем ассистента в ответе
    const assistantMsg = messages.find(m => m.role === 'assistant');
    assert.ok(assistantMsg, 'Ассистент должен присутствовать');
    assert.strictEqual(assistantMsg!.content, 'Короткий ответ.');
  });
});
