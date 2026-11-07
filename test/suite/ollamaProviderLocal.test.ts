// Тесты OllamaProvider (Stage 2): нативный /api/chat на локальном HTTP-сервере.
// Живой Ollama не нужен, в сеть тест не ходит — сервер поднимается внутри теста.
// AC: OLL-1.1, OLL-1.2, OLL-1.3, OLL-1.4, OLL-2.1, OLL-6.1, OLL-6.2, OLL-6.3

import 'mocha';
import * as sinon from 'sinon';
import * as vscode from 'vscode';
import * as assert from 'assert';
import * as http from 'http';
import { OllamaProvider } from '../../src/providers/ollama';

interface Captured {
  body: any;
  headers: http.IncomingHttpHeaders;
}

suite('OllamaProvider (нативный /api/chat)', () => {
  let sandbox: sinon.SinonSandbox;
  let server: http.Server;
  let baseUrl: string;
  let captured: Captured[] = [];
  // Поведение сервера настраивается в каждом тесте
  let handler: (req: http.IncomingMessage, res: http.ServerResponse, body: any) => void;

  const localSettings: Record<string, unknown> = {};

  /** Заглушка vscode.workspace.getConfiguration под llmAssistant.* */
  function stubConfig(): void {
    const mockConfig = {
      get: (key: string, defaultValue?: unknown) => {
        if (key in localSettings) return localSettings[key];
        if (key === 'retry.enabled') return localSettings['retry.enabled'] ?? false;
        if (key === 'debug') return false;
        return defaultValue;
      },
      has: () => false,
      inspect: () => undefined,
      update: () => Promise.resolve(),
    };
    sandbox.stub(vscode.workspace, 'getConfiguration').returns(mockConfig as any);
  }

  setup((done) => {
    sandbox = sinon.createSandbox();
    captured = [];
    for (const key of Object.keys(localSettings)) delete localSettings[key];
    stubConfig();

    server = http.createServer((req, res) => {
      let raw = '';
      req.on('data', (chunk) => (raw += chunk));
      req.on('end', () => {
        const body = raw ? JSON.parse(raw) : {};
        captured.push({ body, headers: req.headers });
        handler(req, res, body);
      });
    });

    server.listen(0, '127.0.0.1', () => {
      const address = server.address() as any;
      baseUrl = `http://127.0.0.1:${address.port}`;
      done();
    });
  });

  teardown((done) => {
    sandbox.restore();
    server.close(() => done());
  });

  function provider(): OllamaProvider {
    return new OllamaProvider({ name: 'local', baseUrl, models: ['qwen3:8b'] });
  }

  /** Ответ NDJSON: массив объектов, каждый — отдельной строкой. */
  function ndjson(res: http.ServerResponse, chunks: any[]): void {
    res.writeHead(200, { 'Content-Type': 'application/x-ndjson' });
    for (const chunk of chunks) res.write(`${JSON.stringify(chunk)}\n`);
    res.end();
  }

  test('OLL-1.1: стримит content из NDJSON в правильном порядке', async () => {
    handler = (_req, res) =>
      ndjson(res, [
        { message: { role: 'assistant', content: 'Рефакторинг' }, done: false },
        { message: { role: 'assistant', content: ' — это' }, done: false },
        { message: { role: 'assistant', content: ' улучшение структуры' }, done: false },
        { message: { role: 'assistant', content: '' }, done: true, eval_count: 7, prompt_eval_count: 12 },
      ]);

    const parts: string[] = [];
    for await (const chunk of provider().chat([{ role: 'user', content: 'привет' }], { model: 'qwen3:8b' })) {
      parts.push(chunk);
    }

    assert.deepStrictEqual(parts, ['Рефакторинг', ' — это', ' улучшение структуры']);
    assert.strictEqual(captured.length, 1);
    assert.strictEqual(captured[0].body.stream, true);
    assert.strictEqual(captured[0].body.model, 'qwen3:8b');
  });

  test('OLL-1.2: think:false по умолчанию, think:true при настройке', async () => {
    handler = (_req, res) => ndjson(res, [{ message: { content: 'ok' }, done: true }]);

    for await (const _ of provider().chat([{ role: 'user', content: 'q' }], { model: 'qwen3:8b' })) {
      /* consume */
    }
    assert.strictEqual(captured[0].body.think, false, 'по умолчанию рассуждение выключено');

    localSettings['local.think'] = true;
    for await (const _ of provider().chat([{ role: 'user', content: 'q' }], { model: 'qwen3:8b' })) {
      /* consume */
    }
    assert.strictEqual(captured[1].body.think, true, 'настройка local.think доходит до тела');
  });

  test('OLL-1.3: maxTokens → num_predict, local.numCtx → num_ctx', async () => {
    handler = (_req, res) => ndjson(res, [{ message: { content: 'ok' }, done: true }]);
    localSettings['local.numCtx'] = 4096;

    for await (const _ of provider().chat([{ role: 'user', content: 'q' }], { model: 'qwen3:8b', maxTokens: 777 })) {
      /* consume */
    }

    assert.strictEqual(captured[0].body.options.num_predict, 777);
    assert.strictEqual(captured[0].body.options.num_ctx, 4096);
    assert.strictEqual(captured[0].body.max_tokens, undefined, 'max_tokens в нативный API не уходит');
  });

  test('OLL-1.4: extraBody игнорируется и не попадает в тело', async () => {
    handler = (_req, res) => ndjson(res, [{ message: { content: 'ok' }, done: true }]);

    for await (const _ of provider().chat([{ role: 'user', content: 'q' }], {
      model: 'qwen3:8b',
      extraBody: { thinking: { type: 'disabled' }, foo: 'bar' },
    })) {
      /* consume */
    }

    assert.strictEqual(captured[0].body.thinking, undefined, 'thinking не отправляется в нативный API');
    assert.strictEqual(captured[0].body.foo, undefined, 'произвольные поля extraBody не проходят');
  });

  test('OLL-2.1: пустой content при непустом thinking → ошибка с подсказкой', async () => {
    handler = (_req, res) =>
      ndjson(res, [
        { message: { content: '', thinking: 'Хорошо, мне нужно перечислить три причины…' }, done: false },
        { message: { content: '', thinking: '…итак, первая причина' }, done: true },
      ]);

    await assert.rejects(
      async () => {
        for await (const _ of provider().chat([{ role: 'user', content: 'q' }], { model: 'qwen3:8b' })) {
          /* consume */
        }
      },
      (err: Error) => {
        assert.match(err.message, /рассуждени/i);
        assert.match(err.message, /local\.think/);
        return true;
      },
    );
  });

  test('OLL-6.1: 404 model not found → подсказка ollama pull, без ретраев', async () => {
    let calls = 0;
    handler = (_req, res) => {
      calls++;
      res.writeHead(404, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'model "qwen3:8b" not found, try pulling it first' }));
    };

    await assert.rejects(
      async () => {
        for await (const _ of provider().chat([{ role: 'user', content: 'q' }], { model: 'qwen3:8b' })) {
          /* consume */
        }
      },
      (err: any) => {
        assert.strictEqual(err.status, 404);
        assert.match(err.message, /ollama pull qwen3:8b/);
        return true;
      },
    );
    assert.strictEqual(calls, 1, '404 не ретраится');
  });

  test('OLL-6.2: сервер недоступен → ошибка соединения с подсказкой', async () => {
    // Берём реально свободный порт: поднимаем сервер, узнаём порт, закрываем.
    // Порт 9 не годится — undici блокирует «bad ports» до попытки соединения.
    const probe = http.createServer(() => undefined);
    const port: number = await new Promise((resolve) => {
      probe.listen(0, '127.0.0.1', () => {
        const address = probe.address() as any;
        probe.close(() => resolve(address.port));
      });
    });
    const dead = new OllamaProvider({ name: 'local', baseUrl: `http://127.0.0.1:${port}`, models: ['qwen3:8b'] });

    await assert.rejects(
      async () => {
        for await (const _ of dead.chat([{ role: 'user', content: 'q' }], { model: 'qwen3:8b' })) {
          /* consume */
        }
      },
      (err: any) => {
        assert.match(err.message, /Ollama/);
        assert.match(err.message, /туннель/);
        assert.ok(err.code, 'код ошибки сохраняется для RetryHandler');
        return true;
      },
    );
  });

  test('OLL-6.3: отмена прерывает поток', async () => {
    handler = (_req, res) => {
      res.writeHead(200, { 'Content-Type': 'application/x-ndjson' });
      res.write(`${JSON.stringify({ message: { content: 'первый' }, done: false })}\n`);
      // дальше молчим — поток должен быть закрыт по отмене
    };

    const controller = new AbortController();
    const received: string[] = [];
    await assert.rejects(async () => {
      for await (const chunk of provider().chat([{ role: 'user', content: 'q' }], { model: 'qwen3:8b' }, controller.signal)) {
        received.push(chunk);
        controller.abort();
      }
      throw new Error('поток не был прерван');
    });
    assert.deepStrictEqual(received, ['первый']);
  });
});
