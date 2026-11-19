// Интеграционные тесты P42 S2: ConversationManager передаёт прежнюю сводку в суммаризатор.
//
// Дефект до правки: при втором переполнении суммаризатор получал только свежеотрезанный кусок,
// поэтому факты первой сводки исчезали из контекста и из журнала. Тесты проверяют именно стык:
// session-log → deriveMessages → previousSummary → промпт суммаризации.

import 'mocha';
import * as sinon from 'sinon';
import * as assert from 'assert';
import * as vscode from 'vscode';
import { ConversationManager } from '../../src/modes/chat/ConversationManager';
import { SessionLog } from '../../src/shared/SessionLog';
import { SUMMARY_MESSAGE_PREFIX } from '../../src/shared/ContextSummarizer';
import { ChatMessage } from '../../src/providers/types';
import { fakeConfiguration, fakeMemento, fakeProvider, ProviderFake } from '../support/fakes';

/** Провайдер-двойник: «суммаризирует» детерминированно — оставляет только увиденные маркеры. */
interface MarkerProvider extends ProviderFake {
  chatComplete: sinon.SinonStub;
  prompts: string[];
}

function makeMarkerProvider(sandbox: sinon.SinonSandbox): MarkerProvider {
  const prompts: string[] = [];
  const provider = { ...fakeProvider(), prompts } as MarkerProvider;
  provider.chatComplete = sandbox.stub().callsFake(async (messages: ChatMessage[]) => {
    const text = messages.map((m) => m.content).join('\n');
    prompts.push(text);
    return ['FACT1', 'FACT2', 'FACT3', 'FACT4'].filter((f) => text.includes(f)).join('; ');
  });
  return provider;
}

/** Конфиг с маленьким бюджетом: переполнение наступает быстро и предсказуемо. */
function setupConfig(sandbox: sinon.SinonSandbox, overrides: Record<string, unknown> = {}): void {
  const cfg = fakeConfiguration((key, defaultValue) => {
    if (key in overrides) return overrides[key];
    if (key === 'chat.maxContextTokens') return 512;
    if (key === 'chat.summaryEnabled') return true;
    if (key === 'chat.summaryModel') return '';
    if (key === 'chat.summaryTriggerTokens') return 256;
    if (key === 'chat.systemPrompt') return 'Ты — AI-ассистент.';
    if (key === 'defaultModel') return 'gpt-4o';
    if (key === 'debug') return false;
    return defaultValue;
  });
  sandbox.stub(vscode.workspace, 'getConfiguration').returns(cfg);
}

/** Добавляет пару сообщений с «наполнителем», чтобы гарантированно превысить бюджет. */
function fill(cm: ConversationManager, tag: string, count: number): void {
  const filler = 'Наполнитель для переполнения контекста. '.repeat(12);
  for (let i = 0; i < count; i++) {
    cm.addMessage({ role: 'user', content: `${tag} ${i}: ${filler}` });
    cm.addMessage({ role: 'assistant', content: `Ответ ${i}: ${filler}` });
  }
}

suite('Summary — накопление через ConversationManager (P42 S2)', () => {
  let sandbox: sinon.SinonSandbox;

  setup(() => {
    sandbox = sinon.createSandbox();
  });

  teardown(() => sandbox.restore());

  test('ST-1: вторая сводка содержит факт первой (путь с session-log)', async () => {
    setupConfig(sandbox);
    const storage = fakeMemento();
    const log = new SessionLog(storage);
    const cm = new ConversationManager(storage, log);
    const provider = makeMarkerProvider(sandbox);

    // Первое переполнение: маркер FACT1 уходит в обрезанную часть
    cm.addMessage({ role: 'user', content: `FACT1: пароль ротирован 12.11. ${'фон '.repeat(80)}` });
    cm.addMessage({ role: 'assistant', content: `Принято. ${'фон '.repeat(80)}` });
    fill(cm, 'Первый блок', 8);
    await cm.getMessagesForRequest(provider);

    assert.ok(provider.prompts.length >= 1, 'первая суммаризация должна вызвать провайдера');
    assert.ok(provider.prompts[0].includes('FACT1'), 'в промпт первой сводки должен попасть FACT1');

    // Второе переполнение: раньше прежняя сводка в промпт не попадала
    fill(cm, 'FACT2 второй блок', 8);
    await cm.getMessagesForRequest(provider);

    assert.ok(provider.prompts.length >= 2, 'вторая суммаризация должна вызвать провайдера');
    assert.ok(
      provider.prompts[1].includes('FACT1'),
      `прежняя сводка обязана попасть в промпт второй суммаризации, промпт: «${provider.prompts[1].slice(0, 300)}»`,
    );
  });

  test('ST-2: прежней сводкой становится маркер, а не основной system-промпт', async () => {
    // Промпт намеренно начинается с тех же слов, что и маркер сводки: граница держится на префиксе,
    // а проверяем обе стороны — настоящая сводка доходит, промпт не доходит
    const promptText = '## Краткое содержание предыдущего диалога: это не сводка, а промпт';
    setupConfig(sandbox, { 'chat.systemPrompt': promptText });
    const storage = fakeMemento();
    const log = new SessionLog(storage);
    const cm = new ConversationManager(storage, log);
    const provider = makeMarkerProvider(sandbox);

    cm.addMessage({ role: 'user', content: `FACT1: пароль ротирован 12.11. ${'фон '.repeat(80)}` });
    cm.addMessage({ role: 'assistant', content: `Принято. ${'фон '.repeat(80)}` });
    fill(cm, 'Первый блок', 8);
    await cm.getMessagesForRequest(provider);

    fill(cm, 'FACT2 второй блок', 8);
    await cm.getMessagesForRequest(provider);

    assert.ok(provider.prompts.length >= 2, 'должны пройти две суммаризации');
    assert.ok(
      provider.prompts[1].includes('FACT1'),
      'прежняя сводка (маркер) должна попасть в промпт второй суммаризации',
    );
    assert.ok(
      !provider.prompts[1].includes('это не сводка, а промпт'),
      'основной system-промпт не должен попасть в суммаризацию как «прежняя сводка»',
    );
  });

  test('ST-3: без переполнения прежняя сводка не передаётся и провайдер не вызывается', async () => {
    setupConfig(sandbox);
    const storage = fakeMemento();
    const log = new SessionLog(storage);
    const cm = new ConversationManager(storage, log);
    const provider = makeMarkerProvider(sandbox);

    cm.addMessage({ role: 'user', content: 'короткий вопрос' });
    cm.addMessage({ role: 'assistant', content: 'короткий ответ' });
    await cm.getMessagesForRequest(provider);

    assert.strictEqual(provider.chatComplete.called, false, 'на короткой истории суммаризации нет');
  });

  test('ST-4: после второй суммаризации в запросе ровно один summary-маркер', async () => {
    setupConfig(sandbox);
    const storage = fakeMemento();
    const log = new SessionLog(storage);
    const cm = new ConversationManager(storage, log);
    const provider = makeMarkerProvider(sandbox);

    cm.addMessage({ role: 'user', content: `FACT1: пароль ротирован 12.11. ${'фон '.repeat(80)}` });
    cm.addMessage({ role: 'assistant', content: `Принято. ${'фон '.repeat(80)}` });
    fill(cm, 'Первый блок', 8);
    await cm.getMessagesForRequest(provider);

    fill(cm, 'FACT2 второй блок', 8);
    const messages = await cm.getMessagesForRequest(provider);

    const markers = messages.filter(
      (m) => m.role === 'system' && m.content.startsWith(SUMMARY_MESSAGE_PREFIX),
    );
    assert.strictEqual(
      markers.length,
      1,
      `в запросе должна быть одна сводка, найдено ${markers.length} — старая и новая одновременно дублируют факты`,
    );
  });
});
