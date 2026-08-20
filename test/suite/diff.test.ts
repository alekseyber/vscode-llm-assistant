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
