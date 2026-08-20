// Тесты ReviewViewProvider — компактная сводка ревью + клик → открытие полного окна

import 'mocha';
import * as assert from 'assert';
import * as sinon from 'sinon';
import { JSDOM } from 'jsdom';
import { ReviewViewProvider } from '../../src/modes/review/ReviewViewProvider';

suite('ReviewViewProvider', () => {
  let sandbox: sinon.SinonSandbox;
  let provider: ReviewViewProvider;

  setup(() => {
    sandbox = sinon.createSandbox();
    provider = new ReviewViewProvider();
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

  test('showReview отправляет компактную сводку (reviewSummary)', async () => {
    const post = sandbox.stub();
    provider.resolveWebviewView(makeView(post), {} as any, {} as any);

    provider.showReview('/tmp/a.ts', '# Полный отчёт', 0.0001);
    await new Promise((r) => setTimeout(r, 0)); // flush executeCommand().then

    assert.ok(post.calledOnce, 'postMessage вызван');
    const msg = post.firstCall.args[0];
    assert.strictEqual(msg.type, 'reviewSummary');
    assert.strictEqual(msg.filePath, '/tmp/a.ts');
    assert.strictEqual(msg.cost, 0.0001);
  });

  test('openReview → onOpen с сохранённым полным отчётом', () => {
    const view = makeView(sandbox.stub());
    let onMsg: (m: any) => void = () => {};
    view.webview.onDidReceiveMessage = (cb: any) => { onMsg = cb; };
    provider.resolveWebviewView(view, {} as any, {} as any);

    provider.showReview('/tmp/a.ts', '# Полный отчёт', 0.0002); // сохранит currentFile/Report/Cost

    const onOpen = sandbox.stub();
    provider.onOpen = onOpen;
    onMsg({ type: 'openReview' });

    assert.ok(onOpen.calledOnce, 'onOpen вызван');
    assert.strictEqual(onOpen.firstCall.args[0], '/tmp/a.ts');
    assert.strictEqual(onOpen.firstCall.args[1], '# Полный отчёт');
    assert.strictEqual(onOpen.firstCall.args[2], 0.0002);
  });

  test('jsdom: сводка рендерится, клик шлёт openReview', () => {
    const view = makeView(sandbox.stub());
    provider.resolveWebviewView(view, {} as any, {} as any);
    const html = view.webview.html;

    const dom = new JSDOM(html, { runScripts: 'outside-only', url: 'http://localhost/' });
    const window = dom.window as any;
    const posted: any[] = [];
    window.acquireVsCodeApi = () => ({ postMessage: (m: any) => posted.push(m) });

    // Выполняем скрипт (один)
    const scripts = Array.from(dom.window.document.querySelectorAll('script')).map((s: any) => s.textContent || '');
    window.eval(scripts[0]);

    // extension → WebView: компактная сводка
    window.dispatchEvent(new window.MessageEvent('message', {
      data: { type: 'reviewSummary', filePath: '/tmp/a.ts', cost: 0.0001 },
    }));

    const fileEl = dom.window.document.getElementById('file-path');
    assert.strictEqual(fileEl!.textContent, '/tmp/a.ts', 'путь файла отрисован');
    assert.strictEqual(dom.window.document.getElementById('summary')!.style.display, 'block', 'сводка показана (display:block)');

    // Клик по строке → openReview в extension
    dom.window.document.getElementById('summary-row')!.click();
    assert.ok(posted.some((m) => m.type === 'openReview'), 'openReview отправлен');
  });
});
