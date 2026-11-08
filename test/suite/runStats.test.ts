// Сводка по истории запусков (P13): стоимость и падения по типам задач.

import 'mocha';
import * as assert from 'assert';
import { computeRunStats, filterRuns, formatStatsLine } from '../../src/shared/runStats';
import { RunEntry } from '../../src/shared/RunHistoryStore';

function run(over: Partial<RunEntry>): RunEntry {
  return {
    id: Math.random().toString(36),
    timestamp: Date.now(),
    mode: 'agent',
    task: 't',
    provider: 'deepseek',
    model: 'deepseek-chat',
    steps: 1,
    tokensIn: 100,
    tokensOut: 50,
    cost: 0.001,
    duration: 1000,
    status: 'success',
    ...over,
  } as RunEntry;
}

suite('runStats / агрегаты', () => {
  test('RS-1: пустая история даёт нули и «Запусков нет»', () => {
    const s = computeRunStats([]);
    assert.strictEqual(s.total, 0);
    assert.strictEqual(s.costTotal, 0);
    assert.strictEqual(s.errorRate, 0);
    assert.deepStrictEqual(s.byMode, []);
    assert.strictEqual(formatStatsLine(s), 'Запусков нет');
  });

  test('RS-2: считается сумма, средняя стоимость и доля ошибок', () => {
    const runs = [
      run({ cost: 0.002, mode: 'agent' }),
      run({ cost: 0.004, mode: 'agent' }),
      run({ cost: 0.006, mode: 'chat', status: 'error' }),
      run({ cost: 0.008, mode: 'chat', status: 'cancelled' }),
    ];
    const s = computeRunStats(runs);
    assert.strictEqual(s.total, 4);
    assert.ok(Math.abs(s.costTotal - 0.02) < 1e-9, String(s.costTotal));
    assert.ok(Math.abs(s.costAvg - 0.005) < 1e-9, String(s.costAvg));
    assert.strictEqual(s.errors, 1);
    assert.strictEqual(s.cancelled, 1);
    assert.ok(Math.abs(s.errorRate - 0.25) < 1e-9);
  });

  test('RS-3: группировка по режиму — стоимость и доля незавершённых успешно', () => {
    const runs = [
      run({ mode: 'agent', cost: 0.010 }),
      run({ mode: 'agent', cost: 0.010, status: 'limit_exceeded' }),
      run({ mode: 'chat', cost: 0.002 }),
    ];
    const s = computeRunStats(runs);
    const agent = s.byMode.find((g) => g.key === 'agent')!;
    assert.strictEqual(agent.count, 2);
    assert.ok(Math.abs(agent.cost - 0.02) < 1e-9);
    assert.ok(Math.abs(agent.failRate - 0.5) < 1e-9, String(agent.failRate));
    assert.strictEqual(s.byMode[0].key, 'agent', 'сортировка по стоимости убыв.');
  });

  test('RS-4: группировка по модели и фильтр по периоду', () => {
    const now = Date.now();
    const runs = [
      run({ model: 'deepseek-chat', cost: 0.01, timestamp: now }),
      run({ model: 'qwen3:8b', cost: 0.02, timestamp: now }),
      run({ model: 'deepseek-chat', cost: 0.05, timestamp: now - 10 * 24 * 3600_000 }),
    ];
    const all = computeRunStats(runs);
    assert.strictEqual(all.byModel.length, 2);
    assert.strictEqual(all.byModel[0].key, 'deepseek-chat');

    const week = computeRunStats(runs, now - 7 * 24 * 3600_000);
    assert.strictEqual(week.total, 2, 'старый запуск отфильтрован');
    assert.ok(Math.abs(week.costTotal - 0.03) < 1e-9);
    assert.strictEqual(filterRuns(runs, now - 7 * 24 * 3600_000).length, 2);
  });

  test('RS-5: строка сводки содержит запуски, суммы и процент ошибок', () => {
    const s = computeRunStats([run({ cost: 0.01 }), run({ cost: 0.03, status: 'error' })]);
    const line = formatStatsLine(s);
    assert.ok(line.includes('2 запусков'), line);
    assert.ok(line.includes('$0.0400'), line);
    assert.ok(line.includes('ошибок 50%'), line);
  });
});
