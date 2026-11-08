// Edit-режим: прогоны должны попадать в историю, а уведомление — показывать диапазон строк (P13).

import 'mocha';
import * as assert from 'assert';
import * as sinon from 'sinon';
import { EditController } from '../../src/modes/edit/EditController';

suite('EditController / история и уведомление', () => {
  test('EDH-1: recordRun пишет режим edit с токенами и стоимостью', () => {
    const store: any = { recordRun: sinon.stub() };
    const controller: any = new EditController({ getDefault: () => undefined } as any, store);

    controller.recordRun('function sum(a, b) {\n  return a + b;\n}', 'function sum(a, b) { return a + b; }', 'сократи код', Date.now() - 100);

    assert.strictEqual(store.recordRun.calledOnce, true, 'прогон записан');
    const entry = store.recordRun.firstCall.args[0];
    assert.strictEqual(entry.mode, 'edit');
    assert.strictEqual(entry.status, 'success');
    assert.ok(entry.tokensIn > 0 && entry.tokensOut > 0, JSON.stringify(entry));
    assert.ok(typeof entry.cost === 'number', 'стоимость посчитана');
    assert.strictEqual(entry.task, 'сократи код');
  });

  test('EDH-2: без store запись не падает (store опционален)', () => {
    const controller: any = new EditController({ getDefault: () => undefined } as any);
    assert.doesNotThrow(() => controller.recordRun('a', 'b', 'c', Date.now()));
  });
});

// ─────────── EDH-3: кнопки «Принять/Отклонить» прямо у кода ───────────
suite('EditController / CodeLens над правкой', () => {
  test('EDH-3: при активной правке линзы содержат команды accept/reject и число строк', () => {
    const controller: any = new EditController({ getDefault: () => undefined } as any);
    assert.deepStrictEqual(controller.getProposalLenses(), [], 'без сессии линз нет');

    controller.currentSession = {
      editor: {},
      selection: { start: { line: 4 }, end: { line: 4 } },
      oldText: 'a',
      newText: 'b',
      diffResult: { addedCount: 3, removedCount: 1 },
    };

    const lenses = controller.getProposalLenses();
    const titles = lenses.map((l: any) => l.title);
    const commands = lenses.filter((l: any) => l.command).map((l: any) => l.command);

    assert.ok(commands.includes('llmAssistant.edit.accept'), JSON.stringify(commands));
    assert.ok(commands.includes('llmAssistant.edit.reject'), JSON.stringify(commands));
    assert.ok(titles.some((x: string) => x.includes('+3') && x.includes('−1')), JSON.stringify(titles));
    assert.ok(lenses.every((l: any) => l.line === 4), 'линзы на строке выделения');
  });
});

// ─────────── EDH-4/5: текст уведомления и жизненный цикл CodeLens ───────────
suite('EditController / уведомление о правке', () => {
  test('EDH-4: уведомление показывает диапазон, счётчики и первую непустую строку кода', () => {
    const controller: any = new EditController({ getDefault: () => undefined } as any);
    const msg = controller.buildProposalMessage({ start: { line: 1 }, end: { line: 1 } }, 3, 1,
      '\n\n  return a + b;\n}');

    assert.ok(msg.includes('Строки 2–2'), msg);
    assert.ok(msg.includes('+3 / −1'), msg);
    assert.ok(msg.includes('Будет: return a + b;'), msg);
    assert.ok(!msg.includes('Принять?') === false, 'вопрос об принятии присутствует');
  });

  test('EDH-4.1: длинная первая строка обрезается до 80 символов', () => {
    const controller: any = new EditController({ getDefault: () => undefined } as any);
    const long = 'x'.repeat(200);
    const msg = controller.buildProposalMessage({ start: { line: 0 }, end: { line: 0 } }, 1, 0, long);
    assert.strictEqual(msg.length < 160, true, `слишком длинное уведомление: ${msg.length}`);
    assert.ok(msg.includes('x'.repeat(80)), 'обрезано ровно по 80');
  });

  test('EDH-4.2: пустой новый текст — уведомление без превью', () => {
    const controller: any = new EditController({ getDefault: () => undefined } as any);
    const msg = controller.buildProposalMessage({ start: { line: 4 }, end: { line: 4 } }, 0, 3, '');
    assert.ok(msg.includes('Строки 5–5'), msg);
    assert.ok(!msg.includes('Будет:'), msg);
  });

  test('EDH-5: после отклонения линзы исчезают', () => {
    const controller: any = new EditController({ getDefault: () => undefined } as any);
    controller.currentSession = {
      editor: { document: { uri: { toString: () => 'file:///a.js' }, languageId: 'javascript' }, options: {} },
      selection: { start: { line: 0 }, end: { line: 0 } },
      oldText: 'a', newText: 'b', diffResult: { addedCount: 1, removedCount: 0 },
    };
    assert.strictEqual(controller.getProposalLenses().length, 3, 'до решения линзы есть');

    controller.handleReject();

    assert.deepStrictEqual(controller.getProposalLenses(), [], 'после отклонения линз нет');
  });
});

// ─────────── EDH-6/7: предложение правки открывается в diff-редакторе ───────────
suite('EditController / diff-предпросмотр предложения', () => {
  const makeEditor = () => {
    const lines = ['function sum(a, b) {', '  return a + b;', '}', ''];
    return {
      document: {
        fileName: '/tmp/demo/scratch.js',
        uri: { path: '/tmp/demo/scratch.js', toString: () => 'file:///tmp/demo/scratch.js', scheme: 'file' },
        languageId: 'javascript',
        getText: () => lines.join('\n'),
        offsetAt: (pos: any) => {
          let off = 0;
          for (let i = 0; i < pos.line; i++) off += lines[i].length + 1;
          return off + (pos.character || 0);
        },
      },
    } as any;
  };

  test('EDH-6: правка открывается в diff — команда vscode.diff получает документы «до» и «после»', async () => {
    const controller: any = new EditController({ getDefault: () => undefined } as any);
    const calls: any[] = [];
    const sinon = require('sinon');
    const stub = sinon.stub(require('vscode').commands, 'executeCommand').callsFake(async (...args: any[]) => { calls.push(args); });

    const editor = makeEditor();
    const selection = { start: { line: 1, character: 2 }, end: { line: 1, character: 4 } };
    let ok = false;
    try {
      ok = await controller.showProposalDiff(editor, selection, '  return Number(a) + Number(b);');
    } finally {
      stub.restore();
    }

    assert.strictEqual(ok, true, 'предпросмотр открыт');
    const diff = calls.find((c) => c[0] === 'vscode.diff');
    assert.ok(diff, 'вызвана команда vscode.diff');
    assert.ok(String(diff[3]).includes('scratch.js'), `заголовок без имени файла: ${diff[3]}`);
  });

  test('EDH-7: настройка edit.showProposalDiff=false отключает предпросмотр', async () => {
    const controller: any = new EditController({ getDefault: () => undefined } as any);
    const vscode = require('vscode');
    const sinon = require('sinon');
    const getConf = vscode.workspace.getConfiguration;
    const stub = sinon.stub(vscode.workspace, 'getConfiguration').returns({
      get: (key: string, def?: any) => (key === 'edit.showProposalDiff' ? false : def),
    } as any);

    let ok = true;
    try {
      ok = await controller.showProposalDiff(makeEditor(), { start: { line: 1, character: 2 }, end: { line: 1, character: 4 } }, 'x');
    } finally {
      stub.restore();
      if (getConf) vscode.workspace.getConfiguration = getConf;
    }
    assert.strictEqual(ok, false, 'предпросмотр отключён настройкой');
  });
});

// ─────────── EDH-8..10: закрытый редактор и уборка diff-окна ───────────
suite('EditController / приём и уборка предпросмотра', () => {
  const vscode = require('vscode');

  function editorFor(uriStr: string, closed = false) {
    return {
      document: { uri: { toString: () => uriStr, scheme: 'file', path: '/a.js', fsPath: '/a.js' }, isClosed: closed, getText: () => '', save: () => Promise.resolve(true) },
      edit: (cb: any) => Promise.resolve(true),
    } as any;
  }

  test('EDH-8: протухший редактор заменяется живым по тому же документу', () => {
    const controller: any = new EditController({ getDefault: () => undefined } as any);
    const stale = editorFor('file:///a.js', true);
    const fresh = editorFor('file:///a.js', false);

    vscode.window.visibleTextEditors = [fresh];
    const resolved = controller.resolveLiveEditor(stale);
    vscode.window.visibleTextEditors = [];

    assert.strictEqual(resolved, fresh, 'взят видимый редактор того же документа');
  });

  test('EDH-8.1: живого редактора нет — resolveLiveEditor вернёт undefined', () => {
    const controller: any = new EditController({ getDefault: () => undefined } as any);
    vscode.window.visibleTextEditors = [];
    assert.strictEqual(controller.resolveLiveEditor(editorFor('file:///b.js', true)), undefined);
  });

  test('EDH-9: closeProposalDiff закрывает только вкладки схемы llma-proposal', async () => {
    const controller: any = new EditController({ getDefault: () => undefined } as any);
    const closed: any[] = [];
    const proposalTab = { input: { uri: { scheme: 'llma-proposal', toString: () => 'llma-proposal:/p-after.js' } } };
    const fileTab = { input: { uri: { scheme: 'file', toString: () => 'file:///a.js' } } };

    const origGroups = vscode.window.tabGroups;
    vscode.window.tabGroups = {
      all: [{ tabs: [proposalTab, fileTab] }],
      close(tab: any) { closed.push(tab); return Promise.resolve(true); },
    };

    try {
      await controller.closeProposalDiff();
    } finally {
      vscode.window.tabGroups = origGroups;
    }

    assert.deepStrictEqual(closed, [proposalTab], 'закрыта только вкладка предпросмотра');
  });

  test('EDH-10: отклонение закрывает diff-окно и чистит сессию', () => {
    const controller: any = new EditController({ getDefault: () => undefined } as any);
    const sinon = require('sinon');
    const closeSpy = sinon.stub(controller, 'closeProposalDiff').resolves();
    vscode.window.visibleTextEditors = [editorFor('file:///a.js', false)];
    controller.currentSession = {
      editor: editorFor('file:///a.js', false),
      selection: { start: { line: 0 }, end: { line: 0 } },
      oldText: 'a', newText: 'b', diffResult: { addedCount: 1, removedCount: 0 },
    };

    try {
      controller.handleReject();
    } finally {
      closeSpy.restore();
      vscode.window.visibleTextEditors = [];
    }

    assert.strictEqual(closeSpy.calledOnce, true, 'окно предпросмотра закрывается');
    assert.strictEqual(controller.currentSession, null, 'сессия очищена');
  });
});
