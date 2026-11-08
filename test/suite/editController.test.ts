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
