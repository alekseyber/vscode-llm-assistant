// Дневной счётчик: слияние записанного значения и кэша окна.
import 'mocha';
import * as assert from 'assert';
import { DailySpendState, fromMicro, mergeDailySpend, toMicro } from '../../src/shared/dailySpend';

const D = '2026-11-13';
const st = (usd: number, rev = 1): DailySpendState => ({ date: D, usdMicro: toMicro(usd), rev });
const usdOf = (s: DailySpendState): number => fromMicro(s.usdMicro);

suite('dailySpend', () => {
  test('DS-1: расход другого окна не затирается локальным кэшем', () => {
    const next = mergeDailySpend(st(1.5, 2), st(1.0, 1), toMicro(0.1), D);
    assert.ok(Math.abs(usdOf(next) - 1.6) < 1e-9, `ожидалось 1.6, получено ${usdOf(next)}`);
  });

  test('DS-2: кэш страхует от асинхронной записи, которая ещё не долетела', () => {
    const next = mergeDailySpend(st(1.0, 1), st(1.1, 1), toMicro(0.1), D);
    assert.ok(Math.abs(usdOf(next) - 1.2) < 1e-9, `ожидалось 1.2, получено ${usdOf(next)}`);
  });

  test('DS-3: смена даты обнуляет базу, битые значения не отравляют счётчик', () => {
    const old: DailySpendState = { date: '2026-11-12', usdMicro: toMicro(5), rev: 9 };
    assert.ok(Math.abs(usdOf(mergeDailySpend(old, old, toMicro(0.2), D)) - 0.2) < 1e-9);
    assert.strictEqual(mergeDailySpend({ date: D, usdMicro: Number.NaN, rev: 1 }, undefined, toMicro(0.3), D).usdMicro, toMicro(0.3));
    assert.strictEqual(mergeDailySpend(undefined, undefined, Number.POSITIVE_INFINITY, D).usdMicro, 0);
    assert.strictEqual(mergeDailySpend(undefined, undefined, -toMicro(1), D).usdMicro, 0, 'отрицательный расход не уменьшает счётчик');
  });

  test('DS-4: ручной сброс не отменяется старым кэшем другого окна', () => {
    const stored: DailySpendState = { date: D, usdMicro: 0, rev: 3 };
    const cached: DailySpendState = { date: D, usdMicro: toMicro(1.5), rev: 2 };
    const next = mergeDailySpend(stored, cached, toMicro(0.25), D);
    assert.ok(Math.abs(usdOf(next) - 0.25) < 1e-9, `сброс должен сохраниться, получено ${usdOf(next)}`);
    assert.strictEqual(next.rev, 4, 'ревизия растёт при каждой записи');
  });

  test('DS-5: деньги считаются в микро-долларах, float не копит ошибку', () => {
    let acc = 0;
    for (let i = 0; i < 10; i += 1) acc += toMicro(0.1);
    assert.strictEqual(acc, 1_000_000, 'десять по 10 центов = ровно 1 доллар');
    assert.strictEqual(fromMicro(acc), 1);
  });

  test('DS-6: при равных ревизиях база — максимум (никто не теряет расход)', () => {
    const next = mergeDailySpend(st(1.0, 5), st(0.4, 5), toMicro(0.1), D);
    assert.ok(Math.abs(usdOf(next) - 1.1) < 1e-9, `ожидалось 1.1, получено ${usdOf(next)}`);
    assert.strictEqual(next.rev, 6);
  });
});
