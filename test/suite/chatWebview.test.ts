// Тесты WebView-фронтенда (main.js) через jsdom — сессионная маршрутизация, git-diff диалог, автокомплит, индикатор.

import 'mocha';
import * as assert from 'assert';
import * as fs from 'fs';
import * as path from 'path';
import { JSDOM } from 'jsdom';

const CHAT_DIR = path.resolve(__dirname, '../../../src/webviews/chat');

interface WebviewHandle {
  window: Window & { eval: (code: string) => any };
  document: Document;
  postedMessages: any[];
  dispatch: (msg: any) => void;
}

/**
 * Загрузить WebView в jsdom: index.html + lineDiff.js + main.js,
 * с моками marked / acquireVsCodeApi / navigator.clipboard.
 */
function loadWebview(): WebviewHandle {
  // Читаем index.html и убираем плейсхолдеры (скрипты/стили грузим отдельно через eval)
  const html = fs.readFileSync(path.join(CHAT_DIR, 'index.html'), 'utf-8')
    .replace('{{STYLES}}', '')
    .replace('{{MARKED_LIB}}', '')
    .replace('{{LINEDIFF}}', '')
    .replace('{{TOOLBAR}}', '')
    .replace('{{SCRIPT}}', '');
  const dom = new JSDOM(html, { runScripts: 'outside-only', url: 'http://localhost/' });
  const window = dom.window as any;

  // WebView → extension: перехватываем postMessage
  const postedMessages: any[] = [];
  window.acquireVsCodeApi = () => ({
    postMessage: (m: any) => { postedMessages.push(m); },
    getState: () => undefined,
    setState: () => {},
  });

  // Stub marked (markdown) и clipboard
  window.marked = { parse: (text: string) => '<p>' + text + '</p>' };
  window.navigator.clipboard = { writeText: () => Promise.resolve() };
  window.URL.createObjectURL = () => 'blob:mock-url';
  window.URL.revokeObjectURL = () => {};

  // Выполняем вспомогательный UMD и основной скрипт
  window.eval(fs.readFileSync(path.join(CHAT_DIR, 'lineDiff.js'), 'utf-8'));
  window.eval(fs.readFileSync(path.join(CHAT_DIR, 'toolbar.js'), 'utf-8'));
  window.eval(fs.readFileSync(path.join(CHAT_DIR, 'main.js'), 'utf-8'));

  // extension → WebView: синхронный dispatch MessageEvent
  const dispatch = (msg: any) => {
    const event = new window.MessageEvent('message', { data: msg });
    window.dispatchEvent(event);
  };

  return { window, document: dom.window.document, postedMessages, dispatch };
}

suite('ChatWebview (jsdom)', () => {
  test('sessionList + streamChunk своей сессии — сообщение попадает в DOM', () => {
    const { dispatch, document } = loadWebview();

    dispatch({ type: 'sessionList', sessions: [{ id: 's1', name: 'A' }, { id: 's2', name: 'B' }], activeId: 's1' });
    dispatch({ type: 'streamChunk', text: 'мой токен', sessionId: 's1' });

    assert.ok(document.body.textContent!.includes('мой токен'), 'токен своей сессии отрисован');
  });

  test('streamChunk из другой сессии игнорируется (маршрутизация)', () => {
    const { dispatch, document } = loadWebview();

    dispatch({ type: 'sessionList', sessions: [{ id: 's1', name: 'A' }, { id: 's2', name: 'B' }], activeId: 's1' });
    dispatch({ type: 'streamChunk', text: 'чужой токен', sessionId: 's2' });

    assert.ok(!document.body.textContent!.includes('чужой токен'), 'токен чужой сессии проигнорирован');
  });

  test('confirmAction (write_file) рендерит git-diff диалог с remove/add', () => {
    const { dispatch, document } = loadWebview();

    dispatch({
      type: 'confirmAction',
      toolName: 'write_file',
      filePath: '/tmp/a.ts',
      oldContent: 'a\nb\nc',
      content: 'a\nx\nc',
      requestId: 'req-1',
    });

    const dialog = document.getElementById('confirm-dialog');
    assert.ok(dialog, 'диалог подтверждения создан');
    assert.ok(dialog!.innerHTML.includes('diff-removed'), 'есть удалённая строка (b)');
    assert.ok(dialog!.innerHTML.includes('diff-added'), 'есть добавленная строка (x)');
  });

  test('confirmAction (write_file) — кнопка «Подтвердить» шлёт confirmResponse approved', () => {
    const { dispatch, document, postedMessages } = loadWebview();

    dispatch({
      type: 'confirmAction',
      toolName: 'write_file',
      filePath: '/tmp/a.ts',
      oldContent: 'a\nb',
      content: 'a\nx',
      requestId: 'req-9',
    });

    const approve = document.querySelector('#confirm-dialog .confirm-approve') as HTMLElement;
    assert.ok(approve, 'кнопка Подтвердить есть');
    approve.click();

    const resp = postedMessages.find((m) => m.type === 'confirmResponse');
    assert.ok(resp, 'confirmResponse отправлен');
    assert.strictEqual(resp.requestId, 'req-9');
    assert.strictEqual(resp.approved, true);
  });

  test('runStarted/runEnded переключают индикатор «в работе»', () => {
    const { dispatch, document } = loadWebview();

    dispatch({ type: 'sessionList', sessions: [{ id: 's1', name: 'A' }], activeId: 's1' });
    dispatch({ type: 'runStarted', runSessionId: 's1' });
    assert.ok(document.body.textContent!.includes('LLM печатает') || !document.getElementById('streaming-indicator')!.classList.contains('hidden'), 'индикатор активен');

    dispatch({ type: 'runEnded', runSessionId: 's1' });
  });

  test('slashCommands + ввод «/» фильтрует попап автокомплита', () => {
    const { dispatch, document, window } = loadWebview();

    dispatch({
      type: 'slashCommands',
      items: [
        { name: 'explain', description: 'Объяснить код', kind: 'command', prefix: '/' },
        { name: 'doc', description: 'Документация', kind: 'command', prefix: '/' },
      ],
    });

    const input = document.getElementById('message-input') as HTMLTextAreaElement;
    input.value = '/ex';
    input.dispatchEvent(new (window as any).Event('input', { bubbles: true }));

    const popup = document.getElementById('slash-autocomplete')!;
    assert.ok(!popup.classList.contains('hidden'), 'попап виден');
    assert.ok(popup.textContent!.includes('explain'), 'отфильтрован explain');
    assert.ok(!popup.textContent!.includes('doc'), 'doc отфильтрован');
  });

  test('planGenerated сохраняет исходную сессию, implementPlan шлёт её (не текущую)', () => {
    const { dispatch, document, postedMessages } = loadWebview();

    // План сгенерирован в сессии A
    dispatch({ type: 'sessionList', sessions: [{ id: 'A', name: 'Первая' }], activeId: 'A' });
    dispatch({ type: 'planGenerated', planContent: '# План', planPath: '/tmp/plan.md', sessionId: 'A' });

    const container = document.getElementById('plan-container')!;
    assert.strictEqual(container.dataset.sessionId, 'A', 'исходная сессия сохранена');
    assert.strictEqual(container.dataset.planPath, '/tmp/plan.md');

    // Переключаемся на сессию B
    dispatch({ type: 'sessionList', sessions: [{ id: 'A', name: 'Первая' }, { id: 'B', name: 'Вторая' }], activeId: 'B' });

    // Клик «Имплементировать» — должен нести исходную сессию A, а не текущую B
    const btn = document.getElementById('btn-implement-plan') as HTMLElement;
    btn.click();

    const implMsg = postedMessages.find((m) => m.type === 'implementPlan');
    assert.ok(implMsg, 'implementPlan отправлен');
    assert.strictEqual(implMsg.sessionId, 'A', 'сессия — исходная A, а не текущая B');
  });

  test('sessionTranscript (copy): транскрипция уходит в clipboard', async () => {
    const { dispatch, window } = loadWebview();
    let copied = '';
    (window.navigator as any).clipboard = { writeText: (t: string) => { copied = t; return Promise.resolve(); } };

    dispatch({ type: 'sessionTranscript', text: '# Сессия\nпривет', action: 'copy' });
    await new Promise(r => setTimeout(r, 20));

    assert.strictEqual(copied, '# Сессия\nпривет', 'текст скопирован в clipboard');
  });

  test('sessionTranscript (download): blob → a.download .md', () => {
    const { dispatch, window } = loadWebview();
    let urlCreated = false;
    (window as any).URL.createObjectURL = () => { urlCreated = true; return 'blob:mock'; };
    let downloadName = '';
    const origCE = window.document.createElement.bind(window.document);
    (window.document as any).createElement = (tag: string) => {
      const el = origCE(tag);
      if (tag === 'a') { (el as any).click = () => { downloadName = (el as any).download; }; }
      return el;
    };

    dispatch({ type: 'sessionTranscript', text: '# Сессия\nпривет', action: 'download' });

    assert.ok(urlCreated, 'createObjectURL вызван (blob создан)');
    assert.ok(downloadName.endsWith('.md'), 'имя файла .md');
  });

  test('toolbar ⋮: primary-иконки видимы, остальные — в ⋮-меню (AC P0-1.2)', () => {
    const { document } = loadWebview();

    const headerActions = document.getElementById('header-actions')!;
    assert.ok(headerActions, 'header-actions есть');

    // Primary-кнопки — .icon-btn с data-action-id (⋮-кнопка не имеет data-action-id)
    const primaryIds = [...headerActions.querySelectorAll('.icon-btn[data-action-id]')]
      .map((b) => (b as HTMLElement).dataset.actionId);
    assert.ok(primaryIds.includes('new-session'), '➕ новая сессия — primary');
    assert.ok(primaryIds.includes('share'), '📋 копировать — primary');

    // ⋮-кнопка и меню
    const moreBtn = document.getElementById('btn-toolbar-more')!;
    assert.ok(moreBtn, '⋮-кнопка есть');

    const menu = document.getElementById('toolbar-menu')!;
    assert.ok(menu, '⋮-меню есть');
    assert.ok(menu.classList.contains('hidden'), 'меню скрыто по умолчанию');

    // Overflow-действия — в меню
    const overflowIds = [...menu.querySelectorAll('.toolbar-menu-item')]
      .map((b) => (b as HTMLElement).dataset.actionId);
    for (const id of ['export', 'clear', 'delete-session', 'delete-all']) {
      assert.ok(overflowIds.includes(id), `${id} — в ⋮-меню`);
    }

    // Деструктив — с классом danger (AC P0-1.4)
    for (const id of ['clear', 'delete-session', 'delete-all']) {
      const item = menu.querySelector(`[data-action-id="${id}"]`) as HTMLElement;
      assert.ok(item.classList.contains('toolbar-menu-danger'), `${id} — деструктив (danger)`);
    }
  });

  test('toolbar ⋮: клик по «Удалить все сессии» шлёт clearAllSessions (AC P0-1.3)', () => {
    const { document, postedMessages } = loadWebview();

    const item = document.querySelector('#toolbar-menu [data-action-id="delete-all"]') as HTMLElement;
    assert.ok(item, 'пункт «Удалить все сессии» есть');
    item.click();

    const msg = postedMessages.find((m) => m.type === 'clearAllSessions');
    assert.ok(msg, 'clearAllSessions отправлен');
  });

  test('toolbar ⋮: клик по ⋮ переключает видимость меню', () => {
    const { document } = loadWebview();

    const moreBtn = document.getElementById('btn-toolbar-more') as HTMLElement;
    const menu = document.getElementById('toolbar-menu')!;
    assert.ok(menu.classList.contains('hidden'), 'изначально скрыто');

    moreBtn.click();
    assert.ok(!menu.classList.contains('hidden'), 'после клика видимо');

    moreBtn.click();
    assert.ok(menu.classList.contains('hidden'), 'повторный клик — скрыто');
  });
});
