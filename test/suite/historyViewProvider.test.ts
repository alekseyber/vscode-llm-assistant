// Тесты HistoryViewProvider — одиночный клик (openSession → onOpenSession), двойной клик (getDetails), clearHistory

import 'mocha';
import * as sinon from 'sinon';
import * as vscode from 'vscode';
import * as assert from 'assert';
import { HistoryViewProvider } from '../../src/modes/history/HistoryViewProvider';
import { RunHistoryStore, RunEntry, generateRunId } from '../../src/shared/RunHistoryStore';

function makeEntry(overrides: Partial<RunEntry> = {}): RunEntry {
  return {
    id: generateRunId(),
    timestamp: Date.now(),
    mode: 'chat',
    task: 'Тестовая задача',
    provider: 'deepseek',
    model: 'deepseek-chat',
    steps: 1,
    tokensIn: 100,
    tokensOut: 50,
    cost: 0.001,
    duration: 500,
    status: 'success',
    sessionId: 'session-1',
    ...overrides,
  };
}

suite('HistoryViewProvider', () => {
  let sandbox: sinon.SinonSandbox;
  let globalState: any;
  let store: RunHistoryStore;
  let provider: HistoryViewProvider;
  let postMessageSpy: sinon.SinonSpy;

  setup(() => {
    sandbox = sinon.createSandbox();

    // Мок globalState с внутренним хранилищем
    let storage: RunEntry[] = [];
    globalState = {
      get: sandbox.stub().callsFake((_key: string, defaultValue: unknown) => storage.length > 0 ? storage : defaultValue),
      update: sandbox.stub().callsFake((_key: string, value: RunEntry[]) => { storage = [...value]; return Promise.resolve(); }),
      keys: sandbox.stub().returns([]),
      setKeysForSync: sandbox.stub(),
    };
    store = new RunHistoryStore(globalState);

    // Мок showWarningMessage (для clearHistory)
    sandbox.stub(vscode.window, 'showWarningMessage').resolves('Да' as any);

    provider = new HistoryViewProvider(store);

    // Резолвим view с перехватом postMessage
    postMessageSpy = sandbox.spy();
    const webviewView: any = {
      webview: {
        options: {},
        html: '',
        postMessage: postMessageSpy,
        onDidReceiveMessage: sandbox.stub(),
      },
    };
    provider.resolveWebviewView(webviewView, {} as any, {} as any);
  });

  teardown(() => sandbox.restore());

  /** Вызвать приватный handleMessage */
  function handle(msg: any): Promise<void> {
    return (provider as any).handleMessage(msg);
  }

  test('openSession вызывает onOpenSession с sessionId (одиночный клик)', async () => {
    const onOpen = sandbox.spy();
    provider.onOpenSession = onOpen;

    await handle({ type: 'openSession', sessionId: 'session-abc' });

    assert.ok(onOpen.calledOnceWith('session-abc'));
  });

  test('openSession без sessionId не вызывает onOpenSession', async () => {
    const onOpen = sandbox.spy();
    provider.onOpenSession = onOpen;

    await handle({ type: 'openSession' });

    assert.ok(onOpen.notCalled);
  });

  test('getDetails отправляет runDetails с найденной записью', async () => {
    store.recordRun(makeEntry({ id: 'run-1', task: 'Найти меня' }));

    await handle({ type: 'getDetails', runId: 'run-1' });

    const call = postMessageSpy.getCalls().find((c) => c.args[0]?.type === 'runDetails');
    assert.ok(call, 'должен быть postMessage runDetails');
    assert.strictEqual(call.args[0].entry.id, 'run-1');
    assert.strictEqual(call.args[0].entry.task, 'Найти меня');
  });

  test('getDetails с несуществующим id не отправляет runDetails', async () => {
    store.recordRun(makeEntry({ id: 'run-1' }));

    await handle({ type: 'getDetails', runId: 'missing' });

    const call = postMessageSpy.getCalls().find((c) => c.args[0]?.type === 'runDetails');
    assert.strictEqual(call, undefined);
  });

  test('clearHistory с подтверждением «Да» очищает историю', async () => {
    store.recordRun(makeEntry({ id: 'run-1' }));
    assert.strictEqual(store.getRuns().length, 1);

    await handle({ type: 'clearHistory' });

    assert.strictEqual(store.getRuns().length, 0);
  });

  test('clearHistory с отказом (undefined) НЕ очищает историю', async () => {
    (vscode.window.showWarningMessage as sinon.SinonStub).resolves(undefined);

    store.recordRun(makeEntry({ id: 'run-1' }));
    await handle({ type: 'clearHistory' });

    assert.strictEqual(store.getRuns().length, 1);
  });

  test('getHtmlContent: детали — оверлей-дровер, не зарезервированная панель', () => {
    const html = (provider as any).getHtmlContent();
    assert.ok(html.includes('detail-overlay'), 'оверлей деталей есть');
    assert.ok(html.includes('detail-backdrop'), 'подложка есть');
    assert.ok(html.includes('id="detail-close"'), 'кнопка ✕ есть');
    assert.ok(!html.includes('detail-panel'), 'старая зарезервированная панель удалена');
  });
});
