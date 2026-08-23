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
    .replace('{{TOOLACTIVITY}}', '')
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

  // Выполняем вспомогательные UMD и основной скрипт
  window.eval(fs.readFileSync(path.join(CHAT_DIR, 'lineDiff.js'), 'utf-8'));
  window.eval(fs.readFileSync(path.join(CHAT_DIR, 'toolbar.js'), 'utf-8'));
  window.eval(fs.readFileSync(path.join(CHAT_DIR, 'toolActivity.js'), 'utf-8'));
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

  test('сайдбар сессий: рендер + активная подсвечена + превью + ⭐ (AC P0-2.1, P0-2.2)', () => {
    const { dispatch, document, postedMessages } = loadWebview();

    dispatch({
      type: 'sessionList',
      sessions: [
        { id: 's1', name: 'Первая', lastActiveAt: Date.now(), createdAt: Date.now(), messageCount: 1, favorite: false, preview: 'превью первой' },
        { id: 's2', name: 'Вторая', lastActiveAt: Date.now(), createdAt: Date.now(), messageCount: 0, favorite: true, preview: '' },
      ],
      activeId: 's1',
    });

    const items = [...document.querySelectorAll('#session-list .session-item')];
    assert.strictEqual(items.length, 2, '2 сессии в сайдбаре');

    const active = document.querySelector('#session-list .session-item.active') as HTMLElement;
    assert.ok(active, 'активная сессия есть');
    assert.strictEqual(active.dataset.sessionId, 's1', 'активная = s1');

    const fav = document.querySelector('#session-list [data-session-id="s2"] .session-item-name') as HTMLElement;
    assert.ok(fav.textContent!.includes('⭐'), 'избранная сессия с ⭐');

    const p1 = document.querySelector('#session-list [data-session-id="s1"] .session-item-preview') as HTMLElement;
    assert.strictEqual(p1.textContent, 'превью первой', 'превью отрисовано');

    // Клик по неактивной сессии → switchSession
    (document.querySelector('#session-list [data-session-id="s2"]') as HTMLElement).click();
    const sw = postedMessages.find((m) => m.type === 'switchSession');
    assert.ok(sw, 'switchSession отправлен');
    assert.strictEqual(sw.sessionId, 's2');
  });

  test('сайдбар: группировка Сегодня/Вчера/7 дней/Ранее (AC P0-2.3)', () => {
    const { dispatch, document } = loadWebview();
    const now = Date.now();
    const day = 86400000;

    dispatch({
      type: 'sessionList',
      sessions: [
        { id: 't', name: 'Сегодняшняя', lastActiveAt: now, createdAt: now, messageCount: 0, favorite: false, preview: '' },
        { id: 'y', name: 'Вчерашняя', lastActiveAt: now - day, createdAt: now - day, messageCount: 0, favorite: false, preview: '' },
        { id: 'w', name: 'Недельная', lastActiveAt: now - 3 * day, createdAt: now - 3 * day, messageCount: 0, favorite: false, preview: '' },
        { id: 'o', name: 'Старая', lastActiveAt: now - 30 * day, createdAt: now - 30 * day, messageCount: 0, favorite: false, preview: '' },
      ],
      activeId: 't',
    });

    const labels = [...document.querySelectorAll('#session-list .session-group-label')].map((e) => e.textContent);
    assert.ok(labels.includes('Сегодня'), 'группа Сегодня');
    assert.ok(labels.includes('Вчера'), 'группа Вчера');
    assert.ok(labels.includes('7 дней'), 'группа 7 дней');
    assert.ok(labels.includes('Ранее'), 'группа Ранее');
  });

  test('сайдбар: действия избранное/переименовать/удалить (AC P0-2.4)', () => {
    const { dispatch, document, postedMessages, window } = loadWebview();

    dispatch({
      type: 'sessionList',
      sessions: [
        { id: 's1', name: 'Первая', lastActiveAt: Date.now(), createdAt: Date.now(), messageCount: 1, favorite: false, preview: '' },
      ],
      activeId: 's1',
    });

    const item = document.querySelector('#session-list [data-session-id="s1"]') as HTMLElement;

    (item.querySelector('.session-action[title="В избранное"]') as HTMLElement).click();
    const fav = postedMessages.find((m) => m.type === 'toggleFavorite');
    assert.ok(fav, 'toggleFavorite отправлен');
    assert.strictEqual(fav.sessionId, 's1');

    // Переименование — инлайн-инпут (не window.prompt, которого нет в WebView)
    (item.querySelector('.session-action[title="Переименовать"]') as HTMLElement).click();
    const input = item.querySelector('.session-rename-input') as HTMLInputElement;
    assert.ok(input, 'инлайн-инпут переименования появился');
    input.value = 'Новое имя';
    input.dispatchEvent(new (window as any).KeyboardEvent('keydown', { key: 'Enter' }));
    const ren = postedMessages.find((m) => m.type === 'renameSession');
    assert.ok(ren, 'renameSession отправлен');
    assert.strictEqual(ren.sessionId, 's1');
    assert.strictEqual(ren.name, 'Новое имя');

    (item.querySelector('.session-action.danger') as HTMLElement).click();
    const del = postedMessages.find((m) => m.type === 'deleteSession');
    assert.ok(del, 'deleteSession отправлен');
    assert.strictEqual(del.sessionId, 's1');
  });

  test('сайдбар: дровер — ☰ открывает / ✕ и подложка закрывают (P0.2-fix)', () => {
    const { document } = loadWebview();
    const sidebar = document.getElementById('session-sidebar') as HTMLElement;
    const backdrop = document.getElementById('sidebar-backdrop') as HTMLElement;
    const toggle = document.getElementById('btn-toggle-sidebar') as HTMLElement;
    const close = document.getElementById('btn-close-sidebar') as HTMLElement;

    // По умолчанию закрыт (не резервирует ширину)
    assert.ok(!sidebar.classList.contains('open'), 'изначально закрыт');
    assert.ok(!backdrop.classList.contains('visible'), 'подложка скрыта');

    // ☰ открывает
    toggle.click();
    assert.ok(sidebar.classList.contains('open'), 'открыт после клика ☰');
    assert.ok(backdrop.classList.contains('visible'), 'подложка видима');

    // ✕ закрывает
    close.click();
    assert.ok(!sidebar.classList.contains('open'), 'закрыт кликом ✕');
    assert.ok(!backdrop.classList.contains('visible'), 'подложка скрыта');

    // Подложка закрывает
    toggle.click();
    backdrop.click();
    assert.ok(!sidebar.classList.contains('open'), 'закрыт кликом по подложке');
    assert.ok(!backdrop.classList.contains('visible'), 'подложка скрыта');
  });

  test('activity-feed: tool_call рендерится дружелюбно (AC P0-3.1, P0-3.2)', () => {
    const { dispatch, document } = loadWebview();
    dispatch({ type: 'toolActivity', activity: { kind: 'start', toolName: 'run_terminal', args: { command: 'npm test' } } });

    const tool = document.querySelector('.activity-tool') as HTMLElement;
    assert.ok(tool, 'шаг создан');
    assert.strictEqual(tool.textContent, 'Команда', 'дружелюбный label вместо run_terminal');

    const icon = document.querySelector('.activity-icon') as HTMLElement;
    assert.strictEqual(icon.textContent, '▶️', 'иконка из маппинга');

    const detail = document.querySelector('.activity-detail') as HTMLElement;
    assert.strictEqual(detail.textContent, 'npm test', 'сводка аргументов');
  });

  test('activity-feed: неизвестный тул → fallback raw name + 🔧', () => {
    const { dispatch, document } = loadWebview();
    dispatch({ type: 'toolActivity', activity: { kind: 'start', toolName: 'some_mcp_tool' } });

    const tool = document.querySelector('.activity-tool') as HTMLElement;
    assert.strictEqual(tool.textContent, 'some_mcp_tool', 'fallback raw name');
    const icon = document.querySelector('.activity-icon') as HTMLElement;
    assert.strictEqual(icon.textContent, '🔧', 'fallback иконка 🔧');
  });

  test('activity-feed: счётчик шагов «· N шаг/шага» (AC P0-3.4)', () => {
    const { dispatch, document } = loadWebview();
    const counter = document.getElementById('activity-counter') as HTMLElement;

    dispatch({ type: 'toolActivity', activity: { kind: 'start', toolName: 'read_file' } });
    dispatch({ type: 'toolActivity', activity: { kind: 'result', toolName: 'read_file', text: 'ok' } });
    assert.strictEqual(counter.textContent, '· 1 шаг', '1 шаг');

    dispatch({ type: 'toolActivity', activity: { kind: 'start', toolName: 'search_files' } });
    dispatch({ type: 'toolActivity', activity: { kind: 'result', toolName: 'search_files', text: 'x\ny' } });
    assert.strictEqual(counter.textContent, '· 2 шага', '2 шага');
  });

  test('activity-feed: индикатор «Думаю» + кнопка «Остановить» (AC P0-3.3)', () => {
    const { document } = loadWebview();

    const dots = document.querySelector('#streaming-indicator .loading-dots') as HTMLElement;
    assert.strictEqual(dots.textContent, 'Думаю', 'текст индикатора — Думаю');

    const cancel = document.getElementById('btn-cancel') as HTMLElement;
    assert.ok(cancel.textContent!.includes('Остановить'), 'кнопка Остановить');
  });

  test('input-toolbar: при загрузке активен Agent (AC P0-4.3)', () => {
    const { document } = loadWebview();

    const agent = document.querySelector('#input-toolbar [data-mode="agent"]') as HTMLElement;
    assert.ok(agent.classList.contains('active'), 'Agent активен по умолчанию');

    const others = [...document.querySelectorAll('#input-toolbar .mode-toggle:not([data-mode="agent"])')];
    for (const b of others) {
      assert.ok(!b.classList.contains('active'), `${(b as HTMLElement).dataset.mode} не активен`);
    }
  });

  test('input-toolbar: клик переключает активный тумблер (AC P0-4.1)', () => {
    const { document } = loadWebview();

    const plan = document.querySelector('#input-toolbar [data-mode="plan"]') as HTMLElement;
    plan.click();
    assert.ok(plan.classList.contains('active'), 'План активен');
    assert.ok(!(document.querySelector('#input-toolbar [data-mode="agent"]') as HTMLElement).classList.contains('active'), 'Agent деактивирован');

    const ask = document.querySelector('#input-toolbar [data-mode="ask"]') as HTMLElement;
    ask.click();
    assert.ok(ask.classList.contains('active'), 'Ask активен');
    assert.ok(!plan.classList.contains('active'), 'План деактивирован');
  });

  test('input-toolbar: Ask → sendMessage mode=chat (AC P0-4.2)', () => {
    const { document, postedMessages } = loadWebview();

    (document.querySelector('#input-toolbar [data-mode="ask"]') as HTMLElement).click();
    (document.getElementById('message-input') as HTMLTextAreaElement).value = 'привет';
    (document.getElementById('btn-send') as HTMLElement).click();

    const msg = postedMessages.find((m) => m.type === 'sendMessage');
    assert.ok(msg, 'sendMessage отправлен');
    assert.strictEqual(msg.mode, 'chat', 'Ask → chat');
    assert.strictEqual(msg.planMode, false, 'не plan');
    assert.strictEqual(msg.text, 'привет', 'текст без префикса');
  });

  test('input-toolbar: План → sendMessage planMode=true (AC P0-4.1)', () => {
    const { document, postedMessages } = loadWebview();

    (document.querySelector('#input-toolbar [data-mode="plan"]') as HTMLElement).click();
    (document.getElementById('message-input') as HTMLTextAreaElement).value = 'задача';
    (document.getElementById('btn-send') as HTMLElement).click();

    const msg = postedMessages.find((m) => m.type === 'sendMessage');
    assert.strictEqual(msg.mode, 'agent', 'План → agent');
    assert.strictEqual(msg.planMode, true, 'planMode=true');
    assert.strictEqual(msg.text, 'задача', 'текст без изменений');
  });

  test('input-toolbar: Субагенты → sendMessage с @orchestrate-префиксом (AC P0-4.1)', () => {
    const { document, postedMessages } = loadWebview();

    (document.querySelector('#input-toolbar [data-mode="subagents"]') as HTMLElement).click();
    (document.getElementById('message-input') as HTMLTextAreaElement).value = 'построй проект';
    (document.getElementById('btn-send') as HTMLElement).click();

    const msg = postedMessages.find((m) => m.type === 'sendMessage');
    assert.strictEqual(msg.mode, 'agent', 'Субагенты → agent');
    assert.strictEqual(msg.planMode, false, 'не plan');
    assert.strictEqual(msg.text, '@orchestrate построй проект', 'префикс @orchestrate добавлен');
  });
});
