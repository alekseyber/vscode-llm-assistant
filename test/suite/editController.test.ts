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
