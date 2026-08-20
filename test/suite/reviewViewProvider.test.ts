// Тесты ReviewViewProvider — панель «Ревью» (showReview + jsdom-рендер отчёта)

import 'mocha';
import * as assert from 'assert';
import * as sinon from 'sinon';
import { JSDOM } from 'jsdom';
import * as vscode from 'vscode';
import { ReviewViewProvider } from '../../src/modes/review/ReviewViewProvider';

suite('ReviewViewProvider', () => {
  let sandbox: sinon.SinonSandbox;
  let provider: ReviewViewProvider;

  setup(() => {
    sandbox = sinon.createSandbox();
    provider = new ReviewViewProvider(vscode.Uri.file('/tmp'));
  });

  teardown(() => sandbox.restore());

  function makeView(postMessageStub: sinon.SinonStub): any {
    return {
      webview: {
        options: {},
        html: '',
        postMessage: postMessageStub,
        onDidReceiveMessage: sandbox.stub(),
      },
    };
  }

  test('showReview отправляет postMessage с отчётом', async () => {
    const post = sandbox.stub();
    provider.resolveWebviewView(makeView(post), {} as any, {} as any);

    provider.showReview('/tmp/a.ts', '# Отчёт', 0.0001);
    await new Promise((r) => setTimeout(r, 0)); // flush executeCommand().then

    assert.ok(post.calledOnce, 'postMessage вызван');
    const msg = post.firstCall.args[0];
    assert.strictEqual(msg.type, 'showReview');
    assert.strictEqual(msg.filePath, '/tmp/a.ts');
    assert.strictEqual(msg.report, '# Отчёт');
    assert.strictEqual(msg.cost, 0.0001);
  });

  test('ready при открытии — повторно шлёт сохранённый отчёт', () => {
    const post = sandbox.stub();
    const view = makeView(post);
    let onMsg: (m: any) => void = () => {};
    view.webview.onDidReceiveMessage = (cb: any) => { onMsg = cb; };

    provider.resolveWebviewView(view, {} as any, {} as any);
    // Имитируем сохранённый отчёт (панель была закрыта, отчёт остался)
    (provider as any).currentReport = '# Отчёт';
    (provider as any).currentFile = '/tmp/a.ts';

    onMsg({ type: 'ready' });

    const msg = post.firstCall.args[0];
    assert.strictEqual(msg.type, 'showReview');
    assert.strictEqual(msg.report, '# Отчёт');
    assert.strictEqual(msg.filePath, '/tmp/a.ts');
  });

  test('HTML рендерит отчёт через marked (jsdom)', () => {
    const view = makeView(sandbox.stub());
    provider.resolveWebviewView(view, {} as any, {} as any);
    const html = view.webview.html;

    const dom = new JSDOM(html, { runScripts: 'outside-only', url: 'http://localhost/' });
    const window = dom.window as any;

    // Мокаем acquireVsCodeApi + marked
    window.acquireVsCodeApi = () => ({ postMessage: () => {} });
    window.marked = { parse: (t: string) => '<p>' + t + '</p>' };

    // Выполняем главный скрипт (последний <script> в HTML)
    const scripts = Array.from(dom.window.document.querySelectorAll('script')).map((s: any) => s.textContent || '');
    window.eval(scripts[scripts.length - 1]);

    // extension → WebView: showReview
    window.dispatchEvent(new window.MessageEvent('message', {
      data: { type: 'showReview', filePath: '/tmp/a.ts', report: '# Отчёт', cost: 0.0001 },
    }));

    const reportEl = dom.window.document.getElementById('report');
    assert.ok(reportEl!.textContent!.includes('# Отчёт'), 'отчёт отрисован в DOM');
    const header = dom.window.document.getElementById('header');
    assert.strictEqual(header!.style.display, '', 'заголовок показан');
  });
});
