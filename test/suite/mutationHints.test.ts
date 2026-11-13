// Подсказки для неприменимых мутаций: когда реализация изменилась, прогон должен не только
// сказать «строка не найдена», но и показать, где теперь живёт похожий код.

import 'mocha';
import * as assert from 'assert';
import * as path from 'path';

const { suggestClosestLines, levenshtein } = require(path.join(__dirname, '../../../scripts/mutation-check.js'));

const CONTENT = [
  'export function reserveForAnswer(windowTokens: number): number {',
  '  return Math.min(32_768, Math.max(512, Math.floor(windowTokens * 0.15)));',
  '}',
  '',
  'export function other(): number {',
  '  return undefined;',
  '}',
].join('\n');

suite('mutationHints', () => {
  test('MT-1: находит строку, в которую превратилась старая формула', () => {
    const hints = suggestClosestLines(CONTENT, '  return Math.min(4096, Math.max(512, 1));', 2);
    assert.ok(hints.length > 0, 'подсказок нет');
    assert.strictEqual(hints[0].line, 2, `первым должен идти код резерва, а не ${hints[0].text}`);
    assert.ok(hints[0].text.includes('32_768'));
  });

  test('MT-2: общие числа поднимают кандидата выше короткой строки', () => {
    const hints = suggestClosestLines(CONTENT, '  return Math.min(4096, 512);', 3);
    assert.ok(hints[0].text.includes('Math.min'), `ожидалась строка с Math.min, получено ${hints[0].text}`);
  });

  test('MT-3: посторонний фрагмент не даёт кандидатов', () => {
    assert.deepStrictEqual(suggestClosestLines(CONTENT, 'targetFramework = net8.0;', 3), []);
  });

  test('MT-4: расстояние Левенштейна считает вставки и замены', () => {
    assert.strictEqual(levenshtein('abc', 'abc'), 0);
    assert.strictEqual(levenshtein('abc', 'ab'), 1);
    assert.strictEqual(levenshtein('abc', 'axc'), 1);
    assert.strictEqual(levenshtein('', 'abc'), 3);
  });
});
