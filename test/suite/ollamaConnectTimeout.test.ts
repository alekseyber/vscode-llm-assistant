// Тесты таймаута установления соединения (P20): мёртвый хост не держит чат 300 с.
// Живой Ollama не нужен — сервер поднимается внутри теста.
// AC: OLL-10.1, OLL-10.2, OLL-10.3, OLL-10.4

import 'mocha';
import * as sinon from 'sinon';
import * as vscode from 'vscode';
import * as assert from 'assert';
import * as http from 'http';
import { AddressInfo } from 'net';
import { fakeConfiguration } from '../support/vscode-harness';
import {
  OllamaProvider,
  fetchWithConnectTimeout,
  __setConnectTimeoutForTests,
  __resetConnectTimeout,
  DEFAULT_CONNECT_TIMEOUT_MS,
} from '../../src/providers/ollama';

suite('Таймаут соединения с Ollama (P20)', () => {
  let sandbox: sinon.SinonSandbox;
  let server: http.Server;
  let port: number;
  let onRequest: (req: http.IncomingMessage, res: http.ServerResponse) => void;
  const localSettings: Record<string, unknown> = {};

  setup((done) => {
    sandbox = sinon.createSandbox();
    for (const key of Object.keys(localSettings)) delete localSettings[key];
    // Настройки: ретраи выключены — проверяем именно одну попытку соединения
    sandbox.stub(vscode.workspace, 'getConfiguration').returns(
      fakeConfiguration((key, defaultValue) => {
        if (key in localSettings) return localSettings[key];
        if (key === 'retry.enabled') return false;
        if (key === 'debug') return false;
        return defaultValue;
      }),
    );
    __resetConnectTimeout();

    server = http.createServer((req, res) => onRequest(req, res));
    server.listen(0, '127.0.0.1', () => {
      port = (server.address() as AddressInfo).port;
      done();
    });
  });

  teardown((done) => {
    __resetConnectTimeout();
    sandbox.restore();
    server.close(() => done());
  });

  test('OLL-10.5: порог по умолчанию не ниже 30 с — иначе холодный старт получает CONNECT_TIMEOUT', () => {
    // Замер на стенде 09.11: первая строка ответа холодного qwen3:8b приходит через 7,0 с,
    // у 14B вдвое больше. Порог ниже этого значения обрывает штатный первый запрос.
    assert.ok(
      DEFAULT_CONNECT_TIMEOUT_MS >= 30_000,
      `порог ${DEFAULT_CONNECT_TIMEOUT_MS} мс обрывает холодный старт модели`,
    );
  });

  test('OLL-10.1: сервер принял соединение и молчит — ошибка через таймаут, код CONNECT_TIMEOUT', async () => {
    onRequest = () => undefined; // ни заголовков, ни тела
    const started = Date.now();

    await assert.rejects(
      () => fetchWithConnectTimeout(`http://127.0.0.1:${port}/api/chat`, { method: 'POST' }, undefined, 150),
      (err: any) => {
        assert.strictEqual(err.code, 'CONNECT_TIMEOUT');
        assert.match(err.message, /не ответила/);
        assert.match(err.message, /запущен/);
        return true;
      },
    );

    const elapsed = Date.now() - started;
    assert.ok(elapsed < 2000, `таймаут сработал быстро (${elapsed} мс), а не по requestTimeout`);
  });

  test('OLL-10.2: заголовки пришли — медленная генерация таймаутом соединения не рвётся', async () => {
    onRequest = (_req, res) => {
      res.writeHead(200, { 'Content-Type': 'application/x-ndjson' });
      res.write(JSON.stringify({ message: { content: 'раз' }, done: false }) + '\n');
      setTimeout(() => {
        res.write(JSON.stringify({ message: { content: 'два' }, done: true, prompt_eval_count: 10 }) + '\n');
        res.end();
      }, 400); // дольше таймаута соединения (150 мс)
    };

    const response = await fetchWithConnectTimeout(
      `http://127.0.0.1:${port}/api/chat`,
      { method: 'POST' },
      undefined,
      150,
    );
    assert.strictEqual(response.status, 200);
    const text = await response.text();
    assert.match(text, /два/, 'тело дочитано после таймаута соединения');
  });

  test('OLL-10.3: погашенный сервер отказывает быстро и без ретраев (тишина ≠ отказ)', async () => {
    // Прежняя редакция ждала CONNECT_TIMEOUT от сервера, который соединение ПРИНЯЛ,
    // но молчал. Это не мёртвый хост, а загружающаяся модель: такой случай теперь
    // ждёт local.requestTimeout. Отказ — это закрытый порт (ECONNREFUSED).
    __setConnectTimeoutForTests(200);
    const dead = new OllamaProvider({ name: 'local', baseUrl: 'http://127.0.0.1:1', models: ['qwen3:8b'] });

    const started = Date.now();
    await assert.rejects(
      async () => {
        for await (const _ of dead.chat([{ role: 'user', content: 'q' }], { model: 'qwen3:8b' })) {
          /* consume */
        }
      },
      (err: any) => {
        assert.match(String(err.message), /ECONNREFUSED|остановлен намеренно/, 'видно, что сервер не отвечает');
        return true;
      },
    );
    assert.ok(Date.now() - started < 2000, 'без ретраев и без ожидания requestTimeout');
  });

  test('OLL-10.4: отмена пользователя не маскируется под таймаут соединения', async () => {
    onRequest = () => undefined;
    const controller = new AbortController();
    setTimeout(() => controller.abort(), 50);

    await assert.rejects(
      () => fetchWithConnectTimeout(`http://127.0.0.1:${port}/api/chat`, { method: 'POST' }, controller.signal, 5000),
      (err: any) => {
        assert.notStrictEqual(err.code, 'CONNECT_TIMEOUT', 'это отмена, а не таймаут');
        return true;
      },
    );
  });
});
