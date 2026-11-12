// Повтор сетевой операции: попытки, паузы, проброс последней ошибки.
//
// Мотив — ложное падение e2e 12.11: скачивание VS Code сдалось после первого таймаута,
// и прогон покраснел, хотя код был ни при чём.

import 'mocha';
import * as assert from 'assert';
import { isTransientError, withRetry } from '../harness/downloadWithRetry';

suite('downloadWithRetry', () => {
  test('DR-1: успешная операция вызывается один раз, пауз нет', async () => {
    const sleeps: number[] = [];
    let calls = 0;
    const value = await withRetry(
      async () => {
        calls += 1;
        return 'ok';
      },
      { sleep: async (ms) => { sleeps.push(ms); } },
    );
    assert.strictEqual(value, 'ok');
    assert.strictEqual(calls, 1);
    assert.deepStrictEqual(sleeps, []);
  });

  test('DR-2: после сбоя повторяет и возвращает результат третьей попытки', async () => {
    const sleeps: number[] = [];
    const retries: number[] = [];
    let calls = 0;
    const value = await withRetry(
      async () => {
        calls += 1;
        if (calls < 3) throw new Error(`request timeout ${calls}`);
        return 'скачано';
      },
      { attempts: 3, delayMs: 1000, sleep: async (ms) => { sleeps.push(ms); }, onRetry: (_e, attempt) => retries.push(attempt) },
    );
    assert.strictEqual(value, 'скачано');
    assert.strictEqual(calls, 3);
    assert.deepStrictEqual(retries, [1, 2], 'повтор объявлен перед каждой следующей попыткой');
    assert.deepStrictEqual(sleeps, [1000, 2000], 'пауза растёт с номером попытки');
  });

  test('DR-3: исчерпав попытки, пробрасывает последнюю ошибку', async () => {
    let calls = 0;
    await assert.rejects(
      () =>
        withRetry(
          async () => {
            calls += 1;
            throw new Error(`socket hang up ${calls}`);
          },
          { attempts: 2, delayMs: 1, sleep: async () => {} },
        ),
      /socket hang up 2/,
      'наружу уходит последняя ошибка, а не первая',
    );
    assert.strictEqual(calls, 2);
  });

  test('DR-4: attempts меньше единицы трактуется как одна попытка', async () => {
    let calls = 0;
    await assert.rejects(
      () => withRetry(async () => { calls += 1; throw new Error('нет сети'); }, { attempts: 0 }),
      /нет сети/,
    );
    assert.strictEqual(calls, 1);
  });

  test('DR-5: постоянная ошибка не повторяется — 404 бессмысленно ждать', async () => {
    let calls = 0;
    await assert.rejects(
      () =>
        withRetry(
          async () => {
            calls += 1;
            throw new Error('404 Not Found');
          },
          { attempts: 3, sleep: async () => {} },
        ),
      /404/,
    );
    assert.strictEqual(calls, 1, 'постоянную ошибку не повторяем');
  });

  test('DR-6: таймаут считается временной ошибкой, 401 — нет', () => {
    assert.strictEqual(isTransientError(new Error('request timeout out after 15000ms')), true);
    assert.strictEqual(isTransientError(new Error('socket hang up')), true);
    assert.strictEqual(isTransientError(new Error('503 Service Unavailable')), true);
    assert.strictEqual(isTransientError(new Error('401 Unauthorized')), false);
    assert.strictEqual(isTransientError(new Error('404 Not Found')), false);
  });

  test('DR-7: при attempts=1 пауз и повторов нет', async () => {
    let calls = 0;
    await assert.rejects(
      () =>
        withRetry(
          async () => {
            calls += 1;
            throw new Error('timeout');
          },
          { attempts: 1, sleep: async () => { throw new Error('sleep не должен вызываться'); } },
        ),
      /timeout/,
    );
    assert.strictEqual(calls, 1);
  });
});
