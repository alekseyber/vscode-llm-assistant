// Тесты человеческих ошибок OpenAI-совместимого провайдера (P18.1 п.2).
// AC: OAI-2.1, OAI-2.2

import 'mocha';
import * as assert from 'assert';
import { toProviderError } from '../../src/providers/openai';

function sdkConnectionError(code?: string): any {
  const err: any = new Error('Connection error.');
  err.name = 'APIConnectionError';
  if (code) {
    err.cause = { code };
  }
  return err;
}

suite('Ошибки OpenAI-совместимого провайдера', () => {
  test('OAI-2.1: локальный движок — подсказка про намеренный запуск и baseUrl', () => {
    const wrapped: any = toProviderError(sdkConnectionError('ECONNREFUSED'), 'http://127.0.0.1:8080/v1', true);

    assert.match(wrapped.message, /локальному серверу/);
    assert.match(wrapped.message, /http:\/\/127\.0\.0\.1:8080\/v1/);
    assert.match(wrapped.message, /остановлен намеренно/);
    assert.match(wrapped.message, /запустите/);
    assert.strictEqual(wrapped.code, 'ECONNREFUSED', 'код остаётся для RetryHandler');
  });

  test('OAI-2.2: облачный провайдер — нейтральный текст, HTTP-ошибки не оборачиваются', () => {
    const cloud: any = toProviderError(sdkConnectionError(), 'https://api.openai.com/v1', false);
    assert.match(cloud.message, /Не удалось подключиться к провайдеру/);
    assert.doesNotMatch(cloud.message, /локальному серверу/);

    const http: any = new Error('Unauthorized');
    http.status = 401;
    assert.strictEqual(toProviderError(http, 'https://api.openai.com/v1', false), http, '401 проходит как есть');
  });
});
