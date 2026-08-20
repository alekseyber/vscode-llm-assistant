// Тесты computeLineDiff — LCS-дифф строк для git-diff диалога подтверждения (WebView)

import 'mocha';
import * as assert from 'assert';
import * as path from 'path';

// UMD-модуль (raw JS) — грузится напрямую из src/webviews/chat/lineDiff.js (не компилируется tsc)
const { computeLineDiff } = require(path.resolve(__dirname, '../../../src/webviews/chat/lineDiff.js')) as {
  computeLineDiff: (oldLines: string[], newLines: string[]) => Array<{ type: 'context' | 'remove' | 'add'; line: string }>;
};

suite('computeLineDiff', () => {
  test('одинаковые строки → все context', () => {
    const ops = computeLineDiff(['a', 'b'], ['a', 'b']);
    assert.deepStrictEqual(ops, [
      { type: 'context', line: 'a' },
      { type: 'context', line: 'b' },
    ]);
  });

  test('одна строка изменена → remove + add', () => {
    const ops = computeLineDiff(['a', 'b', 'c'], ['a', 'x', 'c']);
    assert.deepStrictEqual(ops, [
      { type: 'context', line: 'a' },
      { type: 'remove', line: 'b' },
      { type: 'add', line: 'x' },
      { type: 'context', line: 'c' },
    ]);
  });

  test('строка добавлена → context + add + context', () => {
    const ops = computeLineDiff(['a', 'c'], ['a', 'b', 'c']);
    assert.deepStrictEqual(ops, [
      { type: 'context', line: 'a' },
      { type: 'add', line: 'b' },
      { type: 'context', line: 'c' },
    ]);
  });

  test('строка удалена → context + remove + context', () => {
    const ops = computeLineDiff(['a', 'b', 'c'], ['a', 'c']);
    assert.deepStrictEqual(ops, [
      { type: 'context', line: 'a' },
      { type: 'remove', line: 'b' },
      { type: 'context', line: 'c' },
    ]);
  });

  test('пустой старый → все add', () => {
    const ops = computeLineDiff([], ['a', 'b']);
    assert.deepStrictEqual(ops, [
      { type: 'add', line: 'a' },
      { type: 'add', line: 'b' },
    ]);
  });

  test('пустой новый → все remove', () => {
    const ops = computeLineDiff(['a', 'b'], []);
    assert.deepStrictEqual(ops, [
      { type: 'remove', line: 'a' },
      { type: 'remove', line: 'b' },
    ]);
  });
});
