// Тесты P42 S3 и S6: порог суммаризации и устойчивость к сбоям.
//
// S3 — порог по умолчанию должен быть один: в манифесте (`chat.summaryTriggerTokens` = 2048)
//      и в коде. До правки код откатывался на 256, и фактическое поведение зависело от того,
//      объявлена ли настройка в конфиге.
// S6 — после `sessionLog.truncate` кеш суммаризатора обязан очищаться (журнал перезаписан,
//      ключи кеша относятся к другому набору сообщений), а сбой суммаризации должен быть виден
//      в логе, а не только в debug-режиме.

import 'mocha';
import * as sinon from 'sinon';
import * as assert from 'assert';
import * as vscode from 'vscode';
import { ConversationManager } from '../../src/modes/chat/ConversationManager';
import { SessionLog } from '../../src/shared/SessionLog';
import { ContextSummarizer } from '../../src/shared/ContextSummarizer';
import { fakeConfiguration, fakeMemento, fakeProvider } from '../support/fakes';

function setupConfig(sandbox: sinon.SinonSandbox, overrides: Record<string, unknown> = {}): sinon.SinonStub {
  const stub = sandbox.stub().callsFake((key: string, defaultValue: unknown) => {
    if (key in overrides) return overrides[key];
    if (key === 'chat.maxContextTokens') return 512;
    if (key === 'chat.summaryEnabled') return true;
    if (key === 'chat.summaryModel') return '';
    if (key === 'chat.systemPrompt') return 'Ты — AI-ассистент.';
    if (key === 'defaultModel') return 'gpt-4o';
    if (key === 'debug') return false;
    return defaultValue;
  });
  sandbox.stub(vscode.workspace, 'getConfiguration').returns(fakeConfiguration(stub));
  return stub;
}

function fill(cm: ConversationManager, count = 8): void {
  const filler = 'Наполнитель для переполнения контекста. '.repeat(12);
  for (let i = 0; i < count; i++) {
    cm.addMessage({ role: 'user', content: `Блок ${i}: ${filler}` });
    cm.addMessage({ role: 'assistant', content: `Ответ ${i}: ${filler}` });
  }
}

suite('Summary — порог и устойчивость (P42 S3, S6)', () => {
  let sandbox: sinon.SinonSandbox;

  setup(() => {
    sandbox = sinon.createSandbox();
  });

  teardown(() => sandbox.restore());

  test('SR-1: порог по умолчанию, запрошенный у конфига, равен 2048', async () => {
    // Конфиг не объявляет ключ — проверяем именно значение по умолчанию из кода
    const getStub = setupConfig(sandbox);
    const cm = new ConversationManager(fakeMemento());
    const provider = { ...fakeProvider(), chatComplete: sandbox.stub().resolves('сводка') };

    fill(cm);
    await cm.getMessagesForRequest(provider);

    const call = getStub.getCalls().find((c) => c.args[0] === 'chat.summaryTriggerTokens');
    assert.ok(call, 'порог суммаризации должен запрашиваться у конфига');
    assert.strictEqual(
      call!.args[1],
      2048,
      `значение по умолчанию должно совпадать с манифестом (2048), получено ${call!.args[1]}`,
    );
  });

  test('SR-2: обрезано меньше 2048 токенов — суммаризации нет', async () => {
    // Размеры зафиксированы расчётом, а не «на глаз»: история ≈ 1 100 токенов при бюджете 700,
    // то есть отрезается ≈ 400 токенов — заметно ниже порога 2048. Раньше тест зависел от
    // длины наполнителя и мог ложно упасть, если обрезалось больше порога.
    setupConfig(sandbox, { 'chat.maxContextTokens': 700 });
    const summarizer = new ContextSummarizer();
    const spy = sandbox.stub(summarizer, 'summarizeMessages').resolves('не должно вызываться');
    const cm = new ConversationManager(fakeMemento(), undefined, summarizer);
    const provider = { ...fakeProvider(), chatComplete: sandbox.stub().resolves('ответ') };

    cm.addMessage({ role: 'user', content: `короткое ${'x'.repeat(600)}` });
    cm.addMessage({ role: 'assistant', content: 'ответ' });
    fill(cm, 3);
    await cm.getMessagesForRequest(provider);

    assert.strictEqual(spy.called, false, 'при обрезке меньше порога суммаризации быть не должно');
  });

  test('SR-5: пользовательский порог важнее значения по умолчанию', async () => {
    setupConfig(sandbox, { 'chat.summaryTriggerTokens': 100 });
    const summarizer = new ContextSummarizer();
    const spy = sandbox.stub(summarizer, 'summarizeMessages').resolves('сводка');
    const cm = new ConversationManager(fakeMemento(), undefined, summarizer);
    const provider = { ...fakeProvider(), chatComplete: sandbox.stub().resolves('ответ') };

    fill(cm, 6);
    await cm.getMessagesForRequest(provider);

    assert.ok(spy.called, 'при явно заданном пороге 100 суммаризация обязана запуститься');
  });

  test('SR-6: повторный сбой не забивает лог — не чаще раза в минуту', async () => {
    setupConfig(sandbox, { 'chat.summaryTriggerTokens': 100 });
    const summarizer = new ContextSummarizer();
    sandbox.stub(summarizer, 'summarizeMessages').rejects(new Error('провайдер недоступен'));
    const warn = sandbox.stub(console, 'warn');
    const cm = new ConversationManager(fakeMemento(), undefined, summarizer);
    const provider = { ...fakeProvider(), chatComplete: sandbox.stub().resolves('ответ') };

    fill(cm, 10);
    await cm.getMessagesForRequest(provider);
    fill(cm, 6);
    await cm.getMessagesForRequest(provider);

    const failures = warn.getCalls().filter((c) => String(c.args.join(' ')).includes('Сводка не создана'));
    assert.strictEqual(failures.length, 1, `о сбое должно быть одно сообщение за минуту, было ${failures.length}`);
  });

  test('SR-3: после truncate кеш суммаризатора очищается', async () => {
    // Порог снижен намеренно: проверяем инвалидацию кеша, а не порог
    setupConfig(sandbox, { 'chat.summaryTriggerTokens': 100 });
    const storage = fakeMemento();
    const log = new SessionLog(storage);
    const summarizer = new ContextSummarizer();
    sandbox.stub(summarizer, 'summarizeMessages').resolves('FACT1: сводка');
    const invalidate = sandbox.stub(summarizer, 'invalidateCache');
    const cm = new ConversationManager(storage, log, summarizer);
    const provider = { ...fakeProvider(), chatComplete: sandbox.stub().resolves('ответ') };

    fill(cm, 10);
    invalidate.resetHistory();
    await cm.getMessagesForRequest(provider);

    assert.ok(
      invalidate.called,
      'после sessionLog.truncate кеш суммаризатора обязан очищаться: журнал перезаписан',
    );
  });

  test('SR-4: сбой суммаризации виден в логе, а не только в debug-режиме', async () => {
    setupConfig(sandbox, { 'chat.summaryTriggerTokens': 100 });
    const summarizer = new ContextSummarizer();
    sandbox.stub(summarizer, 'summarizeMessages').rejects(new Error('провайдер недоступен'));
    const warn = sandbox.stub(console, 'warn');
    const cm = new ConversationManager(fakeMemento(), undefined, summarizer);
    const provider = { ...fakeProvider(), chatComplete: sandbox.stub().resolves('ответ') };

    fill(cm, 10);
    const messages = await cm.getMessagesForRequest(provider);

    assert.ok(messages.length > 0, 'запрос должен уйти даже без сводки');
    const logged = warn.getCalls().some((c) => String(c.args.join(' ')).includes('Сводка'));
    assert.ok(logged, 'сбой суммаризации должен попасть в лог (console.warn), иначе он молчаливый');
  });
});
