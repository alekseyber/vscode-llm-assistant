// Тесты computeDiff — чистый LCS-дифф для Edit Mode (git-diff подсветка)

import 'mocha';
import * as assert from 'assert';
import { computeDiff } from '../../src/modes/edit/diff';

suite('computeDiff', () => {
  test('одинаковые тексты → identical, без изменений', () => {
    const r = computeDiff('a\nb\nc', 'a\nb\nc');
    assert.strictEqual(r.identical, true);
    assert.strictEqual(r.addedCount, 0);
    assert.strictEqual(r.removedCount, 0);
    assert.strictEqual(r.changes.length, 3);
    assert.ok(r.changes.every((c) => c.type === 'unchanged'));
  });

  test('пустой старый текст → все строки добавлены', () => {
    const r = computeDiff('', 'a\nb\nc');
    assert.strictEqual(r.identical, false);
    assert.strictEqual(r.addedCount, 3);
    assert.strictEqual(r.removedCount, 0);
    assert.ok(r.changes.every((c) => c.type === 'added'));
  });

  test('пустой новый текст → все строки удалены', () => {
    const r = computeDiff('a\nb\nc', '');
    assert.strictEqual(r.identical, false);
    assert.strictEqual(r.addedCount, 0);
    assert.strictEqual(r.removedCount, 3);
    assert.ok(r.changes.every((c) => c.type === 'removed'));
  });

  test('одна строка заменена → 1 добавлена + 1 удалена', () => {
    const r = computeDiff('a\nb\nc', 'a\nx\nc');
    assert.strictEqual(r.identical, false);
    assert.strictEqual(r.addedCount, 1);
    assert.strictEqual(r.removedCount, 1);
    // строка x добавлена, b удалена
    assert.ok(r.changes.some((c) => c.type === 'added' && c.text === 'x'));
    assert.ok(r.changes.some((c) => c.type === 'removed' && c.text === 'b'));
  });

  test('строка добавлена в середину → добавлена, порядок сохраняется', () => {
    const r = computeDiff('a\nc', 'a\nb\nc');
    assert.strictEqual(r.addedCount, 1);
    assert.strictEqual(r.removedCount, 0);
    const types = r.changes.map((c) => c.type);
    assert.deepStrictEqual(types, ['unchanged', 'added', 'unchanged']);
  });

  test('строка удалена из середины → удалена', () => {
    const r = computeDiff('a\nb\nc', 'a\nc');
    assert.strictEqual(r.addedCount, 0);
    assert.strictEqual(r.removedCount, 1);
    const types = r.changes.map((c) => c.type);
    assert.deepStrictEqual(types, ['unchanged', 'removed', 'unchanged']);
  });

  test('оба пустых текста → пустой diff', () => {
    const r = computeDiff('', '');
    assert.strictEqual(r.identical, true);
    assert.strictEqual(r.changes.length, 0);
    assert.strictEqual(r.addedCount, 0);
    assert.strictEqual(r.removedCount, 0);
  });
});

// ─────────── Декорации Edit: старая подсветка не должна переживать новую правку ───────────
suite('applyDiffDecorations / clearDiffDecorations', () => {
  const sinon = require('sinon');
  const vscode = require('vscode');
  const diffMod = require('../../src/modes/edit/diff');

  function fakeEditor(lines: string[]) {
    const sets: Array<{ type: any; ranges: any[] }> = [];
    return {
      sets,
      document: {
        uri: { toString: () => 'file:///time.js' },
        lineCount: lines.length,
        lineAt: (n: number) => ({ text: lines[n] ?? '' }),
        getText: () => lines.join('\n'),
        getTextInRange: () => lines.join('\n'),
      },
      setDecorations: (type: any, ranges: any[]) => sets.push({ type, ranges }),
    };
  }

  let sandbox: any;
  setup(() => {
    sandbox = sinon.createSandbox();
    let n = 0;
    sandbox.stub(vscode.window, 'createTextEditorDecorationType').callsFake(() => ({ key: `deco-${++n}`, dispose() {} }));
  });
  teardown(() => sandbox.restore());

  test('ED-1.1: вторая правка начинается со снятия декораций первой', () => {
    const editor = fakeEditor(['a', 'b', 'c', 'd']);
    const diff1 = diffMod.computeDiff('a\nb', 'A\nb');
    diffMod.applyDiffDecorations(editor, diff1, 0);
    const firstTypes = editor.sets.map((s: any) => s.type);

    editor.sets.length = 0;
    const diff2 = diffMod.computeDiff('a\nb', 'X\nb');
    diffMod.applyDiffDecorations(editor, diff2, 0);

    const cleared = editor.sets.filter((s: any) => Array.isArray(s.ranges) && s.ranges.length === 0).map((s: any) => s.type);
    assert.ok(cleared.length >= 2, 'старые типы сброшены в пустой список');
    assert.ok(firstTypes.every((t2: any) => cleared.includes(t2)), 'сброшены именно типы предыдущей правки');
  });

  test('ED-1.2: подсветка добавленной строки указывает на строку с новым текстом', () => {
    // old → new: заменена одна строка (minutes1 → minutes2), остальное без изменений
    const oldText = ['  const hours = pad2(now.getHours());', '  const minutes1 = pad2(now.getMinutes());', '', '  return x;'].join('\n');
    const newText = ['  const hours = pad2(now.getHours());', '  const minutes2 = pad2(now.getMinutes());', '', '  return x;'].join('\n');
    const lines = newText.split('\n');
    const editor = fakeEditor(lines);
    const diff = diffMod.computeDiff(oldText, newText);
    diffMod.applyDiffDecorations(editor, diff, 0);

    const added = editor.sets.find((s: any) => s.ranges.length > 0 && s.type.key === 'deco-1');
    const addedLines = (added?.ranges || []).map((r: any) => r.start.line);
    assert.ok(
      addedLines.includes(1),
      `добавленная строка подсвечена на строке с minutes2 (0-based 1), факт: ${JSON.stringify(addedLines)}`,
    );
  });
});
