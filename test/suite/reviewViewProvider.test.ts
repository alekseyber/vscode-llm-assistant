// Тесты ReviewViewProvider — компактная сводка ревью + клик → открытие полного окна

import 'mocha';
import * as assert from 'assert';
import * as sinon from 'sinon';
import { JSDOM } from 'jsdom';
import { ReviewViewProvider } from '../../src/modes/review/ReviewViewProvider';
import { fakeWebviewView, FAKE_RESOLVE_CONTEXT, FAKE_CANCELLATION_TOKEN } from '../support/fakes';

suite('ReviewViewProvider', () => {
  let sandbox: sinon.SinonSandbox;
  let provider: ReviewViewProvider;

  setup(() => {
    sandbox = sinon.createSandbox();
    provider = new ReviewViewProvider();
  });

  teardown(() => sandbox.restore());

  test('showReview отправляет компактную сводку (reviewSummary)', async () => {
    const fake = fakeWebviewView();
    provider.resolveWebviewView(fake.view, FAKE_RESOLVE_CONTEXT, FAKE_CANCELLATION_TOKEN);

    provider.showReview('/tmp/a.ts', '# Полный отчёт', 0.0001);
    await new Promise((r) => setTimeout(r, 0)); // flush executeCommand().then

    assert.strictEqual(fake.messages.length, 1, 'postMessage вызван один раз');
    const msg = fake.messages[0];
    assert.strictEqual(msg.type, 'reviewSummary');
    assert.strictEqual(msg.filePath, '/tmp/a.ts');
    assert.strictEqual(msg.cost, 0.0001);
  });

  test('openReview → onOpen с сохранённым полным отчётом', () => {
    const fake = fakeWebviewView();
    provider.resolveWebviewView(fake.view, FAKE_RESOLVE_CONTEXT, FAKE_CANCELLATION_TOKEN);

    provider.showReview('/tmp/a.ts', '# Полный отчёт', 0.0002); // сохранит currentFile/Report/Cost

    const onOpen = sandbox.stub();
    provider.onOpen = onOpen;
    fake.send({ type: 'openReview' });

    assert.ok(onOpen.calledOnce, 'onOpen вызван');
    assert.strictEqual(onOpen.firstCall.args[0], '/tmp/a.ts');
    assert.strictEqual(onOpen.firstCall.args[1], '# Полный отчёт');
    assert.strictEqual(onOpen.firstCall.args[2], 0.0002);
  });

  test('jsdom: сводка рендерится, клик шлёт openReview', () => {
    const fake = fakeWebviewView();
    provider.resolveWebviewView(fake.view, FAKE_RESOLVE_CONTEXT, FAKE_CANCELLATION_TOKEN);
    const html = fake.view.webview.html;

    const dom = new JSDOM(html, { runScripts: 'outside-only', url: 'http://localhost/' });
    const window = dom.window;
    const posted: Array<{ type?: string }> = [];
    window.acquireVsCodeApi = () => ({ postMessage: (message: { type?: string }) => posted.push(message) });

    // Выполняем скрипт (один)
    const scripts = Array.from(dom.window.document.querySelectorAll('script')).map((s) => s.textContent ?? '');
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
