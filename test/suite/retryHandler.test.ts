// Тесты для RetryHandler — exponential backoff, jitter, таймауты
// Проверяет: ретрай на 429/5xx, НЕ ретрай на 400/401/403/404,
// таймаут → ретрай, max 3 ретрая, jitter ±25%, отключение ретраев

import 'mocha';
import * as sinon from 'sinon';
import * as assert from 'assert';
import {
  withRetry,
  isRetryableError,
  calculateDelay,
  RetryOptions,
} from '../../src/shared/RetryHandler';

suite('RetryHandler', () => {
  let sandbox: sinon.SinonSandbox;
  let clock: sinon.SinonFakeTimers;

  setup(() => {
    sandbox = sinon.createSandbox();
    clock = sandbox.useFakeTimers({ toFake: ['setTimeout', 'Date'] });
  });

  teardown(() => {
    sandbox.restore();
  });

  // ---------------------------------------------------------------------------
  // isRetryableError
  // ---------------------------------------------------------------------------

  suite('isRetryableError', () => {
    const retryOn = [429, 500, 502, 503, 504];

    test('AC-3.1: 429 → retryable', () => {
      assert.ok(isRetryableError({ status: 429 }, retryOn));
    });

    test('AC-3.2: 500 → retryable', () => {
      assert.ok(isRetryableError({ status: 500 }, retryOn));
    });

    test('AC-3.2: 502 → retryable', () => {
      assert.ok(isRetryableError({ status: 502 }, retryOn));
    });

    test('AC-3.2: 503 → retryable', () => {
      assert.ok(isRetryableError({ status: 503 }, retryOn));
    });

    test('AC-3.2: 504 → retryable', () => {
      assert.ok(isRetryableError({ status: 504 }, retryOn));
    });

    test('AC-3.3: 400 → НЕ retryable', () => {
      assert.ok(!isRetryableError({ status: 400 }, retryOn));
    });

    test('AC-3.3: 401 → НЕ retryable', () => {
      assert.ok(!isRetryableError({ status: 401 }, retryOn));
    });

    test('AC-3.3: 403 → НЕ retryable', () => {
      assert.ok(!isRetryableError({ status: 403 }, retryOn));
    });

    test('AC-3.3: 404 → НЕ retryable', () => {
      assert.ok(!isRetryableError({ status: 404 }, retryOn));
    });

    test('AbortError → НЕ retryable (обрабатывается отдельно)', () => {
      const err = new DOMException('aborted', 'AbortError');
      assert.ok(!isRetryableError(err, retryOn));
    });

    test('ECONNRESET → retryable', () => {
      assert.ok(isRetryableError({ code: 'ECONNRESET' }, retryOn));
    });

    test('ETIMEDOUT → retryable', () => {
      assert.ok(isRetryableError({ code: 'ETIMEDOUT' }, retryOn));
    });

    test('ENOTFOUND → retryable', () => {
      assert.ok(isRetryableError({ code: 'ENOTFOUND' }, retryOn));
    });

    test('ECONNREFUSED → retryable', () => {
      assert.ok(isRetryableError({ code: 'ECONNREFUSED' }, retryOn));
    });

    test('"fetch failed" в message → retryable', () => {
      assert.ok(isRetryableError({ message: 'fetch failed' }, retryOn));
    });

    test('"network error" в message → retryable', () => {
      assert.ok(isRetryableError({ message: 'Network Error' }, retryOn));
    });

    test('Неизвестная ошибка → НЕ retryable', () => {
      assert.ok(!isRetryableError({ message: 'something else' }, retryOn));
    });

    test('Пустой объект → НЕ retryable', () => {
      assert.ok(!isRetryableError({}, retryOn));
    });

    test('null/undefined → НЕ retryable', () => {
      assert.ok(!isRetryableError(null, retryOn));
      assert.ok(!isRetryableError(undefined, retryOn));
    });
  });

  // ---------------------------------------------------------------------------
  // calculateDelay — exponential backoff + jitter
  // ---------------------------------------------------------------------------

  suite('calculateDelay (exponential backoff + jitter)', () => {
    test('AC-3.6: jitter в диапазоне ±25% от базовой задержки', () => {
      // attempt=1, baseDelay=1000 → exp=1000, jitter ±25% → [750, 1250]
      for (let i = 0; i < 100; i++) {
        const delay = calculateDelay(1, 1000, 8000);
        assert.ok(delay >= 750, `delay ${delay} должен быть >= 750`);
        assert.ok(delay <= 1250, `delay ${delay} должен быть <= 1250`);
      }
    });

    test('attempt=2 → задержка ~2s (±25%)', () => {
      for (let i = 0; i < 100; i++) {
        const delay = calculateDelay(2, 1000, 8000);
        // exp=2000, jitter → [1500, 2500]
        assert.ok(delay >= 1500, `delay ${delay} должен быть >= 1500`);
        assert.ok(delay <= 2500, `delay ${delay} должен быть <= 2500`);
      }
    });

    test('attempt=3 → задержка ~4s (±25%)', () => {
      for (let i = 0; i < 100; i++) {
        const delay = calculateDelay(3, 1000, 8000);
        // exp=4000, jitter → [3000, 5000]
        assert.ok(delay >= 3000, `delay ${delay} должен быть >= 3000`);
        assert.ok(delay <= 5000, `delay ${delay} должен быть <= 5000`);
      }
    });

    test('Не превышает maxDelayMs', () => {
      for (let i = 0; i < 100; i++) {
        // attempt=10 → exp=512000, capped at 8000, jitter → [6000, 10000]
        const delay = calculateDelay(10, 1000, 8000);
        assert.ok(delay >= 6000, `delay ${delay} должен быть >= 6000`);
        assert.ok(delay <= 10000, `delay ${delay} должен быть <= 10000`);
      }
    });

    test('Разные значения при последовательных вызовах (jitter случаен)', () => {
      const delays = new Set<number>();
      for (let i = 0; i < 20; i++) {
        delays.add(calculateDelay(1, 1000, 8000));
      }
      // Из 20 вызовов должны быть разные значения (jitter работает)
      assert.ok(delays.size > 1, 'jitter должен создавать разные задержки');
    });
  });

  // ---------------------------------------------------------------------------
  // withRetry — основное поведение
  // ---------------------------------------------------------------------------

  suite('withRetry', () => {
    test('Успешный вызов с первой попытки — без ретраев', async () => {
      const fn = sandbox.stub().resolves('ok');
      const onRetry = sandbox.stub();

      const result = await withRetry(fn, { maxRetries: 3, onRetry });

      assert.strictEqual(result, 'ok');
      assert.strictEqual(fn.callCount, 1, 'функция должна быть вызвана 1 раз');
      assert.strictEqual(onRetry.callCount, 0, 'колбэк ретрая не должен вызываться');
    });

    test('AC-3.1: 429 → ретрай через backoff, затем успех', async () => {
      // Первый вызов: 429, второй: успех
      const fn = sandbox.stub();
      fn.onFirstCall().rejects({ status: 429, message: 'Too Many Requests' });
      fn.onSecondCall().resolves('ok');

      const promise = withRetry(fn, { maxRetries: 3, baseDelayMs: 1000 });

      // Продвигаем время: первый ретрай через ~1000ms
      await clock.tickAsync(1500);
      const result = await promise;

      assert.strictEqual(result, 'ok');
      assert.strictEqual(fn.callCount, 2, 'должно быть 2 вызова');
    });

    test('AC-3.2: 500/502/503 → ретрай', async () => {
      const testCodes = [500, 502, 503];

      for (const status of testCodes) {
        const fn = sandbox.stub();
        fn.onFirstCall().rejects({ status, message: 'Server Error' });
        fn.onSecondCall().resolves('ok');

        const promise = withRetry(fn, { maxRetries: 3, baseDelayMs: 100, maxDelayMs: 200 });
        await clock.tickAsync(300);
        const result = await promise;

        assert.strictEqual(result, 'ok', `статус ${status} должен ретраиться`);
        // Сбрасываем для следующей итерации
        sandbox.restore();
        sandbox = sinon.createSandbox();
        clock = sandbox.useFakeTimers({ toFake: ['setTimeout', 'Date'] });
      }
    });

    test('AC-3.3: 400 → НЕ ретрай, сразу ошибка', async () => {
      const fn = sandbox.stub().rejects({ status: 400, message: 'Bad Request' });

      try {
        await withRetry(fn, { maxRetries: 3 });
        assert.fail('Должен быть выброшен exception');
      } catch (error: any) {
        assert.strictEqual(error.status, 400);
        assert.strictEqual(fn.callCount, 1, '400 — только 1 вызов, без ретраев');
      }
    });

    test('AC-3.3: 401 → НЕ ретрай, сразу ошибка', async () => {
      const fn = sandbox.stub().rejects({ status: 401, message: 'Unauthorized' });

      try {
        await withRetry(fn, { maxRetries: 3 });
        assert.fail('Должен быть выброшен exception');
      } catch (error: any) {
        assert.strictEqual(error.status, 401);
        assert.strictEqual(fn.callCount, 1);
      }
    });

    test('AC-3.3: 403 → НЕ ретрай, сразу ошибка', async () => {
      const fn = sandbox.stub().rejects({ status: 403, message: 'Forbidden' });

      try {
        await withRetry(fn, { maxRetries: 3 });
        assert.fail('Должен быть выброшен exception');
      } catch (error: any) {
        assert.strictEqual(error.status, 403);
        assert.strictEqual(fn.callCount, 1);
      }
    });

    test('AC-3.3: 404 → НЕ ретрай, сразу ошибка', async () => {
      const fn = sandbox.stub().rejects({ status: 404, message: 'Not Found' });

      try {
        await withRetry(fn, { maxRetries: 3 });
        assert.fail('Должен быть выброшен exception');
      } catch (error: any) {
        assert.strictEqual(error.status, 404);
        assert.strictEqual(fn.callCount, 1);
      }
    });

    test('AC-3.4: таймаут → ретрай', async () => {
      // Имитируем таймаут: AbortError без пользовательского signal.aborted
      const fn = sandbox.stub();
      let callCount = 0;
      fn.callsFake(() => {
        callCount++;
        if (callCount === 1) {
          const err = new DOMException('The operation was aborted', 'AbortError');
          throw err;
        }
        return Promise.resolve('ok');
      });

      const promise = withRetry(fn, {
        maxRetries: 3,
        requestTimeoutMs: 1000,
        baseDelayMs: 100,
        maxDelayMs: 200,
      });

      await clock.tickAsync(500);
      const result = await promise;

      assert.strictEqual(result, 'ok');
      assert.strictEqual(fn.callCount, 2, 'должен быть 1 ретрай после таймаута');
    });

    test('AC-3.5: max 3 ретрая → после 3-й ошибки исключение', async () => {
      // 1 основная + 3 ретрая = 4 вызова, все с 429
      const fn = sandbox.stub().rejects({ status: 429, message: 'Too Many Requests' });

      try {
        const promise = withRetry(fn, {
          maxRetries: 3,
          baseDelayMs: 100,
          maxDelayMs: 200,
        });

        // Продвигаем время для каждого ретрая
        await clock.tickAsync(1000);
        await promise;

        assert.fail('Должен быть выброшен exception после 3 ретраев');
      } catch (error: any) {
        assert.strictEqual(error.status, 429);
        assert.strictEqual(fn.callCount, 4, 'должно быть 4 вызова (1 основной + 3 ретрая)');
      }
    });

    test('AC-3.5: maxRetries=0 → без ретраев, сразу ошибка', async () => {
      const fn = sandbox.stub().rejects({ status: 500, message: 'Server Error' });

      try {
        await withRetry(fn, { maxRetries: 0 });
        assert.fail('Должен быть выброшен exception');
      } catch (error: any) {
        assert.strictEqual(error.status, 500);
        assert.strictEqual(fn.callCount, 1, 'только 1 вызов без ретраев');
      }
    });

    test('onRetry колбэк вызывается при каждом ретрае', async () => {
      const fn = sandbox.stub();
      fn.onFirstCall().rejects({ status: 429, message: 'Rate limit' });
      fn.onSecondCall().rejects({ status: 429, message: 'Rate limit' });
      fn.onThirdCall().resolves('ok');

      const onRetry = sandbox.stub();

      const promise = withRetry(fn, {
        maxRetries: 3,
        baseDelayMs: 100,
        maxDelayMs: 200,
        onRetry,
      });

      await clock.tickAsync(1000);
      await promise;

      assert.strictEqual(onRetry.callCount, 2, 'колбэк должен вызываться 2 раза (2 ретрая)');

      // Проверяем аргументы первого вызова
      const firstCall = onRetry.firstCall.args;
      assert.strictEqual(firstCall[0], 1, 'attempt = 1');
      assert.strictEqual(firstCall[1], 3, 'maxRetries = 3');
      assert.ok(typeof firstCall[2] === 'number', 'delayMs — число');
      assert.ok(typeof firstCall[3] === 'string', 'errorMsg — строка');
    });

    test('Пользовательский AbortSignal прерывает ретраи', async () => {
      const controller = new AbortController();
      const fn = sandbox.stub().rejects({ status: 429, message: 'Rate limit' });

      const promise = withRetry(fn, {
        maxRetries: 3,
        baseDelayMs: 1000,
        signal: controller.signal,
      });

      // Даём выполниться первому вызову (он упадёт) и начать ожидание ретрая
      await clock.tickAsync(500);

      // Отменяем во время ожидания ретрая
      controller.abort();

      try {
        await clock.tickAsync(1000);
        await promise;
        assert.fail('Должен быть AbortError');
      } catch (error: any) {
        assert.strictEqual(error.name, 'AbortError');
      }
    });

    test('Прерванный сигнал до вызова — сразу AbortError', async () => {
      const controller = new AbortController();
      controller.abort(); // уже отменён

      const fn = sandbox.stub().resolves('ok');

      try {
        await withRetry(fn, { signal: controller.signal });
        assert.fail('Должен быть AbortError');
      } catch (error: any) {
        assert.strictEqual(error.name, 'AbortError');
        assert.strictEqual(fn.callCount, 0, 'функция не должна вызываться');
      }
    });

    test('Функция получает AbortSignal при вызове', async () => {
      const fn = sandbox.stub().callsFake((sig?: AbortSignal) => {
        assert.ok(sig instanceof AbortSignal, 'сигнал должен быть передан');
        return Promise.resolve('ok');
      });

      const result = await withRetry(fn, { requestTimeoutMs: 5000 });
      assert.strictEqual(result, 'ok');
      assert.strictEqual(fn.callCount, 1);
      // Проверяем, что сигнал был передан
      const passedSignal = fn.firstCall.args[0];
      assert.ok(passedSignal instanceof AbortSignal);
    });
  });

  // ---------------------------------------------------------------------------
  // AC-3.7: Отключение ретраев через maxRetries=0
  // ---------------------------------------------------------------------------

  suite('AC-3.7: отключение ретраев', () => {
    test('maxRetries=0 → сетевые ошибки не ретраятся', async () => {
      const fn = sandbox.stub().rejects({ code: 'ECONNRESET', message: 'connection reset' });

      try {
        await withRetry(fn, { maxRetries: 0 });
        assert.fail('Должен быть exception');
      } catch (error: any) {
        assert.strictEqual(error.code, 'ECONNRESET');
        assert.strictEqual(fn.callCount, 1, 'только 1 вызов');
      }
    });
  });
});
