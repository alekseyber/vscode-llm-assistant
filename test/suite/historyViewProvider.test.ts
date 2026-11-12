// Тесты HistoryViewProvider — одиночный клик (openSession → onOpenSession), двойной клик (getDetails), clearHistory

import 'mocha';
import * as fs from 'fs';
import * as path from 'path';
import * as sinon from 'sinon';
import { DOMWindow, JSDOM } from 'jsdom';
import * as vscode from 'vscode';
import * as assert from 'assert';
import { HistoryViewProvider } from '../../src/modes/history/HistoryViewProvider';
import { RunHistoryStore, RunEntry, generateRunId } from '../../src/shared/RunHistoryStore';
import { fakeWebviewView, WebviewViewFake, FAKE_RESOLVE_CONTEXT, FAKE_CANCELLATION_TOKEN } from '../support/fakes';

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
  let webview: WebviewViewFake;
  let warning: sinon.SinonStub;

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

    // Мок showWarningMessage (для clearHistory): пользователь отвечает «Да»
    warning = sandbox.stub(vscode.window, 'showWarningMessage');
    warning.callsFake(async () => 'Да');

    provider = new HistoryViewProvider(store, vscode.Uri.file("/ext"));

    // Резолвим view: fakeWebviewView отдаёт html/postMessage и канал сообщений от WebView
    webview = fakeWebviewView();
    provider.resolveWebviewView(webview.view, FAKE_RESOLVE_CONTEXT, FAKE_CANCELLATION_TOKEN);
  });

  teardown(() => sandbox.restore());

  /** Доставить сообщение из WebView и дать провайдеру доработать асинхронно. */
  async function receive(msg: unknown): Promise<void> {
    webview.send(msg);
    await new Promise((resolve) => setTimeout(resolve, 0));
  }

  test('openSession вызывает onOpenSession с sessionId (одиночный клик)', async () => {
    const onOpen = sandbox.spy();
    provider.onOpenSession = onOpen;

    await receive({ type: 'openSession', sessionId: 'session-abc' });

    assert.ok(onOpen.calledOnceWith('session-abc'));
  });

  test('openSession без sessionId не вызывает onOpenSession', async () => {
    const onOpen = sandbox.spy();
    provider.onOpenSession = onOpen;

    await receive({ type: 'openSession' });

    assert.ok(onOpen.notCalled);
  });

  test('getDetails отправляет runDetails с найденной записью', async () => {
    store.recordRun(makeEntry({ id: 'run-1', task: 'Найти меня' }));

    await receive({ type: 'getDetails', runId: 'run-1' });

    const call = webview.messages.find((m) => m.type === 'runDetails');
    assert.ok(call, 'должен быть postMessage runDetails');
    assert.strictEqual(call.entry.id, 'run-1');
    assert.strictEqual(call.entry.task, 'Найти меня');
  });

  test('getDetails с несуществующим id не отправляет runDetails', async () => {
    store.recordRun(makeEntry({ id: 'run-1' }));

    await receive({ type: 'getDetails', runId: 'missing' });

    const call = webview.messages.find((m) => m.type === 'runDetails');
    assert.strictEqual(call, undefined);
  });

  test('clearHistory с подтверждением «Да» очищает историю', async () => {
    store.recordRun(makeEntry({ id: 'run-1' }));
    assert.strictEqual(store.getRuns().length, 1);

    await receive({ type: 'clearHistory' });

    assert.strictEqual(store.getRuns().length, 0);
  });

  test('clearHistory с отказом (undefined) НЕ очищает историю', async () => {
    warning.resolves(undefined);

    store.recordRun(makeEntry({ id: 'run-1' }));
    await receive({ type: 'clearHistory' });

    assert.strictEqual(store.getRuns().length, 1);
  });

  test('HV-13: в деталях прогона видно вызовы инструментов (замер поиска)', () => {
    const html = webview.view.webview.html;
    assert.match(html, /Инструменты:/, 'поле для замера рендерится в деталях');
    assert.match(html, /entry\.tools/, 'значение берётся из записи истории');
  });

  test('HV-14: прогноз и авто-выбор модели видны в истории', () => {
    const html = webview.view.webview.html;
    assert.match(html, /forecastUsd/, 'прогноз стоимости рендерится в деталях');
    assert.match(html, /Прогноз \/ факт/, 'рядом с фактом видно, что было обещано');
    assert.match(html, /auto-badge/, 'пометка «авто» есть в разметке');
    assert.match(html, /routeReason/, 'причина решения роутера выводится в деталях');
  });

  test('getHtmlContent: детали — оверлей-дровер, не зарезервированная панель', () => {
    const html = webview.view.webview.html;
    assert.ok(html.includes('detail-overlay'), 'оверлей деталей есть');
    assert.ok(html.includes('detail-backdrop'), 'подложка есть');
    assert.ok(html.includes('id="detail-close"'), 'кнопка ✕ есть');
    assert.ok(!html.includes('detail-panel'), 'старая зарезервированная панель удалена');
  });
});

/** HTML вкладки истории: тот же путь, что у VS Code — через resolveWebviewView. */
function historyHtml(store: RunHistoryStore): string {
  const provider = new HistoryViewProvider(store, vscode.Uri.file("/ext"));
  const fake = fakeWebviewView();
  provider.resolveWebviewView(fake.view, FAKE_RESOLVE_CONTEXT, FAKE_CANCELLATION_TOKEN);
  return fake.view.webview.html;
}

// ─────────── HV-8: фильтр по режиму реально фильтрует строки ───────────
suite('HistoryViewProvider / WebView: фильтр по режиму', () => {
  function buildDom(): JSDOM {
    const store: any = { getRuns: () => [], onDidChange: () => ({ dispose() {} }) };
    return new JSDOM(historyHtml(store), {
      runScripts: 'dangerously',
      beforeParse(window: DOMWindow) {
        window.acquireVsCodeApi = () => ({ postMessage() {}, getState() {}, setState() {} });
      },
    });
  }

  test('HV-8: после смены селектора остаются только записи выбранного режима', () => {
    const dom = buildDom();
    const { window } = dom;
    const doc = window.document;

    const runs = [
      { id: '1', timestamp: Date.now(), mode: 'chat', task: 'a', provider: 'p', model: 'm', steps: 1, tokensIn: 1, tokensOut: 1, cost: 0, duration: 1, status: 'success' },
      { id: '2', timestamp: Date.now(), mode: 'agent', task: 'b', provider: 'p', model: 'm', steps: 1, tokensIn: 1, tokensOut: 1, cost: 0, duration: 1, status: 'success' },
      { id: '3', timestamp: Date.now(), mode: 'edit', task: 'c', provider: 'p', model: 'm', steps: 1, tokensIn: 1, tokensOut: 1, cost: 0, duration: 1, status: 'success' },
    ];
    window.dispatchEvent(new window.MessageEvent('message', { data: { type: 'refresh', runs, statsLine: '3 запусков' } }));

    const rows = () => doc.querySelectorAll('#table-body tr').length;
    assert.strictEqual(rows(), 3, 'без фильтра видны все три');

    const select = doc.querySelector<HTMLSelectElement>('#mode-filter')!;
    select.value = 'edit';
    select.dispatchEvent(new window.Event('change'));

    assert.strictEqual(rows(), 1, 'после фильтра остаётся одна строка');
    const statsText = doc.getElementById('stats-line')!.textContent ?? '';
    assert.ok(statsText.includes('фильтр показал 1 из 3'), `нет пометки фильтра: ${statsText}`);
  });
});

// ─────────── HV-9..12: поведение фильтра по режиму ───────────
suite('HistoryViewProvider / WebView: фильтр по режиму, крайние случаи', () => {

  function run(id: string, mode: string, extra: any = {}) {
    return Object.assign({
      id, timestamp: Date.now(), mode, task: 't', provider: 'p', model: 'm',
      steps: 1, tokensIn: 1, tokensOut: 1, cost: 0, duration: 1, status: 'success',
    }, extra);
  }

  function mount(runs: any[], statsLine = 'x') {
    const store: any = { getRuns: () => [], onDidChange: () => ({ dispose() {} }) };
    const dom = new JSDOM(historyHtml(store), {
      runScripts: 'dangerously',
      beforeParse(window: DOMWindow) {
        window.acquireVsCodeApi = () => ({ postMessage() {}, getState() {}, setState() {} });
      },
    });
    const { window } = dom;
    const refresh = (list: any[]) => window.dispatchEvent(
      new window.MessageEvent('message', { data: { type: 'refresh', runs: list, statsLine } }),
    );
    refresh(runs);
    const select = (value: string) => {
      const el = window.document.querySelector<HTMLSelectElement>('#mode-filter')!;
      el.value = value;
      el.dispatchEvent(new window.Event('change'));
    };
    const rows = () => window.document.querySelectorAll('#table-body tr').length;
    const stats = () => window.document.getElementById('stats-line')!.textContent ?? '';
    const empty = () => window.document.getElementById('empty-state')!;
    return { window, refresh, select, rows, stats, empty };
  }

  test('HV-9: фильтр «Агент» оставляет только агентские прогоны', () => {
    const h = mount([run('1', 'chat'), run('2', 'agent'), run('3', 'edit')]);
    h.select('agent');
    assert.strictEqual(h.rows(), 1);
    assert.ok(h.stats().includes('фильтр показал 1 из 3'), h.stats());
  });

  test('HV-10: нет записей выбранного режима — пустое состояние и «0 из N»', () => {
    const h = mount([run('1', 'chat'), run('2', 'agent')]);
    h.select('edit');
    assert.strictEqual(h.rows(), 0);
    assert.strictEqual(h.empty().textContent, 'Нет записей с выбранным фильтром');
    assert.notStrictEqual(h.empty().style.display, 'none', 'плашка пустого состояния видна');
    assert.ok(h.stats().includes('фильтр показал 0 из 2'), h.stats());
  });

  test('HV-11: возврат к «Все» снимает фильтр и пометку в сводке', () => {
    const h = mount([run('1', 'chat'), run('2', 'agent')]);
    h.select('agent');
    h.select('all');
    assert.strictEqual(h.rows(), 2);
    assert.strictEqual(h.stats().includes('фильтр показал'), false, h.stats());
  });

  test('HV-12: обновление истории не сбрасывает фильтр и пересчитывает «N из M»', () => {
    const h = mount([run('1', 'chat'), run('2', 'agent')]);
    h.select('agent');
    h.refresh([run('1', 'chat'), run('2', 'agent'), run('3', 'agent'), run('4', 'edit')]);
    assert.strictEqual(h.rows(), 2, 'фильтр сохранился после refresh');
    assert.ok(h.stats().includes('фильтр показал 2 из 4'), h.stats());
  });
});
