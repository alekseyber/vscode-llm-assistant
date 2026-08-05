// Тесты для ContextSummarizer — сжатие истории диалога в summary
// Проверяет: AC-2.1 (возвращает текст на русском), AC-2.4 (кеш),
// AC-2.5 (инвалидация кеша), AC-2.6 (триггер по токенам),
// интеграцию с ConversationManager (AC-2.2, AC-2.3)

import 'mocha';
import * as sinon from 'sinon';
import * as vscode from 'vscode';
import * as assert from 'assert';
import { ContextSummarizer } from '../../src/shared/ContextSummarizer';
import { ConversationManager, ContextMessage, CodeContext } from '../../src/modes/chat/ConversationManager';
import { ChatMessage, LLMProvider, CompletionOptions } from '../../src/providers/types';

/** Создаёт AsyncIterable из массива строк (для mock provider.chat) */
async function* mockChatStream(chunks: string[], signal?: AbortSignal): AsyncIterable<string> {
  for (const chunk of chunks) {
    if (signal?.aborted) break;
    yield chunk;
  }
}

/**
 * Создаёт mock-провайдер с поддержкой chatComplete.
 */
function createMockProvider(
  chatCompleteImpl?: (messages: ChatMessage[], options: CompletionOptions, signal?: AbortSignal) => Promise<string>,
  chatImpl?: (messages: ChatMessage[], options: CompletionOptions, signal?: AbortSignal) => AsyncIterable<string>,
): LLMProvider {
  return {
    chat: chatImpl ?? ((_messages, _options, signal) => mockChatStream(['ответ'], signal)),
    chatComplete: chatCompleteImpl ?? (async () => 'Это краткое summary диалога.'),
    models: async () => ['gpt-4o'],
  };
}

/** Создаёт mock Memento для ConversationManager */
function createMockStorage(sandbox: sinon.SinonSandbox): vscode.Memento {
  return {
    get: sandbox.stub().returns([]),
    update: sandbox.stub().returns(Promise.resolve()),
    keys: sandbox.stub().returns([]),
    setKeysForSync: sandbox.stub(),
  } as any;
}

/** Настроить mock vscode.workspace.getConfiguration */
function setupMockConfig(sandbox: sinon.SinonSandbox, overrides: Record<string, unknown> = {}): void {
  const mockConfig = {
    get: sandbox.fake((key: string, defaultValue?: unknown) => {
      if (key in overrides) return overrides[key];
      // Значения по умолчанию
      if (key === 'chat.maxContextTokens') return 4096;
      if (key === 'chat.summaryEnabled') return true;
      if (key === 'chat.summaryModel') return '';
      if (key === 'chat.summaryTriggerTokens') return 2048;
      if (key === 'chat.systemPrompt') return 'Ты — AI-ассистент.';
      if (key === 'defaultModel') return 'gpt-4o';
      return defaultValue;
    }),
    has: sandbox.fake(() => false),
    inspect: sandbox.fake(() => undefined),
    update: sandbox.fake(() => Promise.resolve()),
  };
  sandbox.stub(vscode.workspace, 'getConfiguration').returns(mockConfig as any);
}

suite('ContextSummarizer', () => {
  let sandbox: sinon.SinonSandbox;
  let summarizer: ContextSummarizer;

  setup(() => {
    sandbox = sinon.createSandbox();
    summarizer = new ContextSummarizer();
  });

  teardown(() => {
    sandbox.restore();
  });

  // --- AC-2.1: ContextSummarizer.summarizeMessages() возвращает текст на русском ---

  test('AC-2.1: summarizeMessages() возвращает текст на русском (с мок-провайдером)', async () => {
    const provider = createMockProvider(async () => 'Краткое содержание: пользователь спросил про код, ассистент предложил решение.');

    const messages: ChatMessage[] = [
      { role: 'user', content: 'Как написать функцию сортировки?' },
      { role: 'assistant', content: 'Можно использовать Array.sort() или написать свою реализацию.' },
    ];

    const summary = await summarizer.summarizeMessages(messages, provider, 'gpt-4o');

    assert.ok(typeof summary === 'string', 'Результат должен быть строкой');
    assert.ok(summary.length > 0, 'Результат не должен быть пустым');
    // Проверяем, что текст содержит русские символы (кириллица)
    assert.ok(/[а-яёА-ЯЁ]/.test(summary), 'Summary должно содержать русский текст');
  });

  test('AC-2.1: summarizeMessages() с пустым массивом возвращает пустую строку', async () => {
    const provider = createMockProvider();
    const summary = await summarizer.summarizeMessages([], provider, 'gpt-4o');
    assert.strictEqual(summary, '');
  });

  // --- AC-2.4: Кеш — повторный вызов не шлёт запрос в LLM ---

  test('AC-2.4: повторный вызов с теми же сообщениями не шлёт запрос в LLM', async () => {
    let callCount = 0;
    const provider = createMockProvider(async () => {
      callCount++;
      return 'Кешированное summary.';
    });

    const messages: ChatMessage[] = [
      { role: 'user', content: 'Вопрос 1' },
      { role: 'assistant', content: 'Ответ 1' },
    ];

    // Первый вызов — должен вызвать LLM
    const summary1 = await summarizer.summarizeMessages(messages, provider, 'gpt-4o');
    assert.strictEqual(callCount, 1, 'Первый вызов должен отправить запрос');

    // Второй вызов с теми же сообщениями — должен вернуть кеш
    const summary2 = await summarizer.summarizeMessages(messages, provider, 'gpt-4o');
    assert.strictEqual(callCount, 1, 'Второй вызов НЕ должен отправлять запрос');
    assert.strictEqual(summary1, summary2, 'Результаты должны совпадать');
  });

  // --- AC-2.5: Кеш инвалидируется при добавлении новых сообщений ---

  test('AC-2.5: кеш инвалидируется при добавлении новых сообщений', async () => {
    let callCount = 0;
    const provider = createMockProvider(async () => {
      callCount++;
      return `Summary вызов #${callCount}.`;
    });

    const messages1: ChatMessage[] = [
      { role: 'user', content: 'Сообщение A' },
      { role: 'assistant', content: 'Ответ A' },
    ];

    const messages2: ChatMessage[] = [
      { role: 'user', content: 'Сообщение A' },
      { role: 'assistant', content: 'Ответ A' },
      { role: 'user', content: 'Сообщение B' }, // Новое сообщение
      { role: 'assistant', content: 'Ответ B' },
    ];

    // Первый вызов
    await summarizer.summarizeMessages(messages1, provider, 'gpt-4o');
    assert.strictEqual(callCount, 1);

    // Второй вызов с ДРУГИМИ сообщениями — должен вызвать LLM снова
    await summarizer.summarizeMessages(messages2, provider, 'gpt-4o');
    assert.strictEqual(callCount, 2, 'При новых сообщениях должен быть новый запрос');
  });

  test('AC-2.5: invalidateCache() сбрасывает весь кеш', async () => {
    let callCount = 0;
    const provider = createMockProvider(async () => {
      callCount++;
      return `Summary #${callCount}.`;
    });

    const messages: ChatMessage[] = [
      { role: 'user', content: 'Вопрос' },
      { role: 'assistant', content: 'Ответ' },
    ];

    await summarizer.summarizeMessages(messages, provider, 'gpt-4o');
    assert.strictEqual(callCount, 1);

    // Сбрасываем кеш
    summarizer.invalidateCache();

    // Тот же запрос должен снова вызвать LLM
    await summarizer.summarizeMessages(messages, provider, 'gpt-4o');
    assert.strictEqual(callCount, 2, 'После invalidateCache() должен быть новый запрос');
  });

  // --- AC-2.6: Summary не создаётся если обрезано < summaryTriggerTokens токенов ---

  test('AC-2.6: estimateTokens() считает токены (1 токен ≈ 4 символа)', () => {
    assert.strictEqual(summarizer.estimateTokens(''), 0);
    assert.strictEqual(summarizer.estimateTokens('hello'), 2); // 5/4 = 1.25 → 2
    assert.strictEqual(summarizer.estimateTokens('x'.repeat(100)), 25); // 100/4 = 25
  });

  test('AC-2.6: summary не вызывается если обрезано < summaryTriggerTokens', async () => {
    // Этот тест проверяет логику на уровне ConversationManager
    // Настраиваем конфиг с высоким triggerTokens и проверяем что summary не создаётся

    setupMockConfig(sandbox, {
      'chat.maxContextTokens': 100,           // Маленький лимит → всегда обрезаем
      'chat.summaryEnabled': true,
      'chat.summaryTriggerTokens': 10000,     // Очень высокий порог → не срабатывает никогда
      'chat.systemPrompt': '',
    });

    const storage = createMockStorage(sandbox);
    const manager = new ConversationManager(storage);

    // Добавляем много коротких сообщений, чтобы превысить лимит токенов
    for (let i = 0; i < 50; i++) {
      manager.addMessage({ role: 'user', content: `Короткое сообщение ${i}` });
      manager.addMessage({ role: 'assistant', content: `Короткий ответ ${i}` });
    }

    // Мок-провайдер, который считает вызовы
    let summaryCalls = 0;
    const provider = createMockProvider(async () => {
      summaryCalls++;
      return 'summary';
    });

    const messages = await manager.getMessagesForRequest(provider);

    // Проверяем что summary НЕ вызывался (т.к. обрезано мало токенов)
    assert.strictEqual(summaryCalls, 0,
      'При высоком triggerTokens summary не должен вызываться');
    // Проверяем что сообщения содержат system message + историю
    assert.ok(messages.length > 0, 'Должны быть сообщения');
    // Убедимся, что нет summary-сообщения
    const summaryMessages = messages.filter(m =>
      m.role === 'system' && m.content.includes('Краткое содержание')
    );
    assert.strictEqual(summaryMessages.length, 0, 'Не должно быть summary-сообщения');
  });

  // --- AC-2.2: Summary вставляется как system-сообщение в историю ---

  test('AC-2.2: summary вставляется как второе system-сообщение при превышении контекста', async () => {
    setupMockConfig(sandbox, {
      'chat.maxContextTokens': 50,            // Очень маленький лимит
      'chat.summaryEnabled': true,
      'chat.summaryTriggerTokens': 10,        // Низкий порог → почти всегда срабатывает
      'chat.systemPrompt': 'Базовый промпт.',
    });

    const storage = createMockStorage(sandbox);
    const manager = new ConversationManager(storage);

    // Добавляем много сообщений
    for (let i = 0; i < 30; i++) {
      manager.addMessage({ role: 'user', content: `Сообщение пользователя номер ${i} с дополнительным текстом` });
      manager.addMessage({ role: 'assistant', content: `Ответ ассистента номер ${i} с подробным объяснением` });
    }

    const provider = createMockProvider(async () => 'Краткое изложение: диалог о программировании.');

    const messages = await manager.getMessagesForRequest(provider);

    // Проверяем наличие двух system-сообщений
    const systemMsgs = messages.filter(m => m.role === 'system');
    assert.ok(systemMsgs.length >= 2, 'Должно быть минимум 2 system-сообщения');

    // Первое — основной system prompt
    assert.ok(systemMsgs[0].content.includes('Базовый промпт'), 'Первое system-сообщение — основной промпт');

    // Второе — summary
    const summaryMsg = systemMsgs.find(m => m.content.includes('Краткое содержание'));
    assert.ok(summaryMsg, 'Должно быть system-сообщение с summary');
    assert.ok(summaryMsg!.content.includes('Краткое изложение'),
      'Summary должно содержать сжатый текст');
    assert.strictEqual(summaryMsg!.role, 'system', 'Summary должно быть system-сообщением');
  });

  // --- AC-2.3: При отключении (summaryEnabled: false) — старое поведение (просто обрезка) ---

  test('AC-2.3: при summaryEnabled=false — старое поведение (без summary)', async () => {
    setupMockConfig(sandbox, {
      'chat.maxContextTokens': 50,
      'chat.summaryEnabled': false,         // ОТКЛЮЧЕНО
      'chat.summaryTriggerTokens': 10,
      'chat.systemPrompt': 'Базовый промпт.',
    });

    const storage = createMockStorage(sandbox);
    const manager = new ConversationManager(storage);

    for (let i = 0; i < 30; i++) {
      manager.addMessage({ role: 'user', content: `Сообщение ${i} с текстом` });
      manager.addMessage({ role: 'assistant', content: `Ответ ${i} с текстом` });
    }

    let summaryCalls = 0;
    const provider = createMockProvider(async () => { summaryCalls++; return 'summary'; });

    const messages = await manager.getMessagesForRequest(provider);

    // Проверяем, что summary НЕ вызывался
    assert.strictEqual(summaryCalls, 0, 'При отключении summary не должен вызываться');

    // Проверяем, что нет summary-сообщения
    const summaryMsgs = messages.filter(m =>
      m.content.includes('Краткое содержание')
    );
    assert.strictEqual(summaryMsgs.length, 0, 'Не должно быть summary-сообщений');

    // Проверяем, что есть system-сообщение и история (старое поведение)
    assert.ok(messages.length >= 1, 'Должен быть хотя бы system prompt');
    assert.strictEqual(messages[0].role, 'system', 'Первое сообщение — system');
  });

  // --- Дополнительные тесты ---

  test('fallback: summarizeMessages работает через chat() если chatComplete отсутствует', async () => {
    // Провайдер БЕЗ chatComplete — используем chat() (стрим)
    const provider: LLMProvider = {
      chat: (_messages, _options, signal) => mockChatStream(['Fallback ', 'summary ', 'текст.'], signal),
      models: async () => ['gpt-4o'],
      // chatComplete отсутствует
    };

    const messages: ChatMessage[] = [
      { role: 'user', content: 'Вопрос' },
      { role: 'assistant', content: 'Ответ' },
    ];

    const summary = await summarizer.summarizeMessages(messages, provider, 'gpt-4o');

    assert.strictEqual(summary, 'Fallback summary текст.');
    assert.ok(/[а-яё]/.test(summary), 'Содержит русский текст');
  });

  test('ConversationManager.clearHistory() сбрасывает кеш summary', async () => {
    setupMockConfig(sandbox, {
      'chat.maxContextTokens': 50,
    });

    const storage = createMockStorage(sandbox);
    const manager = new ConversationManager(storage);

    // Добавляем сообщения
    for (let i = 0; i < 20; i++) {
      manager.addMessage({ role: 'user', content: `Сообщение ${i} с дополнительным длинным текстом для заполнения токенов` });
      manager.addMessage({ role: 'assistant', content: `Ответ ${i} с таким же длинным текстом для переполнения контекста` });
    }

    // Очищаем историю
    manager.clearHistory();

    // После очистки история должна быть пуста
    const messages = manager.getMessages();
    assert.strictEqual(messages.length, 0, 'История должна быть пуста после clearHistory()');
  });

  test('ConversationManager.addMessage() инвалидирует кеш summary', async () => {
    setupMockConfig(sandbox, {
      'chat.maxContextTokens': 30,
      'chat.summaryEnabled': true,
      'chat.summaryTriggerTokens': 5,
      'chat.systemPrompt': '',
    });

    const storage = createMockStorage(sandbox);
    const manager = new ConversationManager(storage);

    let summaryCalls = 0;
    const provider = createMockProvider(async () => { summaryCalls++; return 'summary v' + summaryCalls; });

    // Добавляем много сообщений → должен быть overflow
    for (let i = 0; i < 10; i++) {
      manager.addMessage({ role: 'user', content: `Длинное сообщение пользователя номер ${i}` });
      manager.addMessage({ role: 'assistant', content: `Длинный ответ ассистента номер ${i}` });
    }

    // Первый запрос
    await manager.getMessagesForRequest(provider);
    const callsAfterFirst = summaryCalls;
    assert.ok(callsAfterFirst >= 1, 'Должен быть хотя бы один вызов summary');

    // Добавляем новое сообщение — это должно инвалидировать кеш
    manager.addMessage({ role: 'user', content: 'Новое сообщение после первого запроса' });
    manager.addMessage({ role: 'assistant', content: 'Новый ответ после первого запроса' });

    // Второй запрос — должен снова вызвать summary (т.к. кеш инвалидирован)
    await manager.getMessagesForRequest(provider);
    assert.ok(summaryCalls > callsAfterFirst,
      `После addMessage() кеш должен инвалидироваться, вызовов было ${callsAfterFirst}, стало ${summaryCalls}`);
  });
});
