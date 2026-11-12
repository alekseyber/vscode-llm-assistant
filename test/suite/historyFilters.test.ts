// Фильтр панели истории: логика вынесена из разметки в media/history-filters.js и проверяется здесь.
//
// Мотив: режим фильтровался inline-скриптом webview, статуса не было вовсе — а всё, что живёт
// в строке HTML, не видят ни типы, ни тесты.

import 'mocha';
import * as assert from 'assert';
import * as path from 'path';

const { filterRuns, emptyStateText, filterSuffix } = require(path.join(__dirname, '../../../media/history-filters.js'));

const runs = [
  { mode: 'chat', status: 'success' },
  { mode: 'agent', status: 'error' },
  { mode: 'agent', status: 'cancelled' },
  { mode: 'edit', status: 'success' },
];

suite('historyFilters', () => {
  test('HF-1: фильтр по статусу оставляет только совпадения', () => {
    assert.deepStrictEqual(filterRuns(runs, { status: 'error' }), [{ mode: 'agent', status: 'error' }]);
    assert.strictEqual(filterRuns(runs, { status: 'success' }).length, 2);
  });

  test('HF-2: режим и статус применяются вместе', () => {
    assert.deepStrictEqual(filterRuns(runs, { mode: 'agent', status: 'cancelled' }), [{ mode: 'agent', status: 'cancelled' }]);
    assert.deepStrictEqual(filterRuns(runs, { mode: 'chat', status: 'error' }), []);
  });

  test('HF-3: «all» и пустые значения ничего не фильтруют и не мутируют исходный массив', () => {
    const copy = filterRuns(runs, { mode: 'all', status: 'all' });
    assert.strictEqual(copy.length, 4);
    assert.notStrictEqual(copy, runs, 'возвращается копия, а не исходный массив');
  });

  test('HF-4: пустое состояние и подпись различают «нет истории» и «фильтр ничего не нашёл»', () => {
    assert.strictEqual(emptyStateText({ mode: 'all', status: 'all' }), 'История запусков пуста');
    assert.strictEqual(emptyStateText({ status: 'error' }), 'Нет записей с выбранным фильтром');
    assert.strictEqual(filterSuffix(1, 4, { status: 'error' }), ' · фильтр показал 1 из 4');
    assert.strictEqual(filterSuffix(4, 4, { mode: 'all', status: 'all' }), '');
  });
});
