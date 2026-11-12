// Интеграционный тест: Summary при переполнении контекста
// Проверяет: мок-провайдер → длинная история → summary в system-сообщении

import * as sinon from 'sinon';
import * as assert from 'assert';
import * as vscode from 'vscode';
import { ConversationManager } from '../../src/modes/chat/ConversationManager';
import { fakeProvider, ProviderFake } from '../support/fakes';

/** Провайдер-двойник с подставным нестриминговым ответом (им пользуется summary). */
interface SummaryProvider extends ProviderFake {
  chatComplete: sinon.SinonStub;
}

function makeSummaryProvider(sandbox: sinon.SinonSandbox, summary: string): SummaryProvider {
  return { ...fakeProvider(), chatComplete: sandbox.stub().resolves(summary) };
}

suite('Summary — интеграция с ConversationManager', () => {
  let sandbox: sinon.SinonSandbox;
  let storage: any;
  let config: vscode.WorkspaceConfiguration;

  setup(() => {
    sandbox = sinon.createSandbox();
    storage = {
      get: sandbox.stub().returns({}),
      update: sandbox.stub().returns(Promise.resolve()),
      keys: sandbox.stub().returns([]),
      setKeysForSync: sandbox.stub(),
    };
    // Мок getConfiguration
    config = {
      get: sandbox.stub().callsFake((key: string, defaultValue: unknown) => {
        if (key === 'chat.maxContextTokens') return 512;
        if (key === 'chat.summaryEnabled') return true;
        if (key === 'chat.summaryModel') return '';
        if (key === 'defaultModel') return 'deepseek-v4-pro';
        if (key === 'chat.summaryTriggerTokens') return 256;
        if (key === 'chat.systemPrompt') return 'Ты — AI-ассистент.';
        if (key === 'debug') return false;
        return defaultValue;
      }),
      has: sandbox.stub().returns(false),
      inspect: sandbox.stub().returns(undefined),
      update: sandbox.stub().returns(Promise.resolve()),
    };
    sandbox.stub(vscode.workspace, 'getConfiguration').returns(config);
    sandbox.stub(vscode.workspace, 'workspaceFolders').value([{
      uri: vscode.Uri.file('/tmp/test-workspace'),
      name: 'test',
      index: 0,
    }]);
    sandbox.stub(vscode.workspace, 'onDidChangeTextDocument').returns({ dispose: () => {} });
  });

  teardown(() => sandbox.restore());

  test('Длинная история → system-сообщение с summary', async () => {
    const cm = new ConversationManager(storage);

    // Добавляем много сообщений (чтобы превысить maxContextTokens=512)
    for (let i = 0; i < 15; i++) {
      cm.addMessage({ role: 'user', content: `Очень длинное сообщение номер ${i} с кучей текста чтобы превысить лимит токенов контекста. `.repeat(5) });
      cm.addMessage({ role: 'assistant', content: `Ответ на сообщение ${i}. `.repeat(5) });
    }

    // Мок-провайдер с chatComplete
    const mockProvider = makeSummaryProvider(sandbox, 'Краткое содержание: пользователь спрашивал о тестах.');

    const messages = await cm.getMessagesForRequest(mockProvider);

    // Проверяем что есть system-сообщение с summary
    const summaryMessage = messages.find(m =>
      m.role === 'system' && m.content.includes('## Краткое содержание')
    );
    assert.ok(summaryMessage, 'Должно быть system-сообщение с summary');
    assert.ok(summaryMessage!.content.includes('Краткое содержание'), 'Summary должен содержать заголовок');
  });

  test('Короткая история → без summary', async () => {
    const cm = new ConversationManager(storage);

    // Добавляем пару сообщений (влезает в maxContextTokens=512)
    cm.addMessage({ role: 'user', content: 'Привет' });
    cm.addMessage({ role: 'assistant', content: 'Здравствуй' });

    const mockProvider = makeSummaryProvider(sandbox, 'Не должно вызываться');

    const messages = await cm.getMessagesForRequest(mockProvider);

    // Проверяем что НЕТ system-сообщения с summary
    const summaryMessage = messages.find(m =>
      m.role === 'system' && m.content.includes('## Краткое содержание')
    );
    assert.strictEqual(summaryMessage, undefined, 'Не должно быть summary для короткой истории');
    assert.strictEqual(mockProvider.chatComplete.called, false, 'chatComplete не должен вызываться');
  });

  test('summaryEnabled=false → без summary даже при длинной истории', async () => {
    // Переопределяем конфиг
    config.get = sandbox.stub().callsFake((key: string, defaultValue: unknown) => {
      if (key === 'chat.summaryEnabled') return false;
      if (key === 'chat.maxContextTokens') return 100;
      if (key === 'chat.summaryTriggerTokens') return 256;
      if (key === 'chat.systemPrompt') return 'Ты — AI.';
      if (key === 'debug') return false;
      return defaultValue;
    });

    const cm = new ConversationManager(storage);

    for (let i = 0; i < 15; i++) {
      cm.addMessage({ role: 'user', content: `Сообщение ${i}. `.repeat(10) });
      cm.addMessage({ role: 'assistant', content: `Ответ ${i}. `.repeat(10) });
    }

    const mockProvider = makeSummaryProvider(sandbox, 'Не должно вызываться');

    const messages = await cm.getMessagesForRequest(mockProvider);

    const summaryMessage = messages.find(m =>
      m.role === 'system' && m.content.includes('## Краткое содержание')
    );
    assert.strictEqual(summaryMessage, undefined, 'При summaryEnabled=false не должно быть summary');
  });
});
