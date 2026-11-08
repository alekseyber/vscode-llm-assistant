// Тесты OllamaProvider (Stage 2): нативный /api/chat на локальном HTTP-сервере.
// Живой Ollama не нужен, в сеть тест не ходит — сервер поднимается внутри теста.
// AC: OLL-1.1, OLL-1.2, OLL-1.3, OLL-1.4, OLL-2.1, OLL-6.1, OLL-6.2, OLL-6.3

import 'mocha';
import * as sinon from 'sinon';
import * as vscode from 'vscode';
import * as assert from 'assert';
import * as http from 'http';
import {
  OllamaProvider,
  describeLocalServer,
  toNativeMessages,
  toNativeVisionMessages,
  toOpenAIToolCalls,
  __resetTruncationWarningState,
} from '../../src/providers/ollama';

interface Captured {
  body: any;
  headers: http.IncomingHttpHeaders;
}

suite('OllamaProvider (нативный /api/chat)', () => {
  let sandbox: sinon.SinonSandbox;
  let server: http.Server;
  let baseUrl: string;
  let captured: Captured[] = [];
  // Счётчик обращений по путям — для проверки кэша discovery
  let hits: Record<string, number> = {};
  // Поведение сервера настраивается в каждом тесте
  let handler: (req: http.IncomingMessage, res: http.ServerResponse, body: any) => void;
  // Шпион за предупреждениями UI (OLL-9.x): мок не пишет вызовы сам, поэтому оборачиваем
  let warnSpy: sinon.SinonSpy;

  const localSettings: Record<string, unknown> = {};

  /** Заглушка vscode.workspace.getConfiguration под llmAssistant.* */
  function stubConfig(): void {
    const mockConfig = {
      get: (key: string, defaultValue?: unknown) => {
        if (key in localSettings) return localSettings[key];
        if (key === 'retry.enabled') return localSettings['retry.enabled'] ?? false;
        if (key === 'debug') return localSettings['debug'] ?? false;
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
    hits = {};
    for (const key of Object.keys(localSettings)) delete localSettings[key];
    stubConfig();
    // Сброс module-level состояния предупреждений: иначе тесты влияют друг на друга (R2 ревью)
    __resetTruncationWarningState();
    warnSpy = sandbox.spy(vscode.window, 'showWarningMessage') as sinon.SinonSpy;

    server = http.createServer((req, res) => {
      const pathName = (req.url ?? '').split('?')[0];
      hits[pathName] = (hits[pathName] ?? 0) + 1;
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

  // ─────────── Stage 3: discovery и команда проверки ───────────

  test('OLL-4.1: /api/tags → список моделей, конфиг первым, кэш 30 с', async () => {
    handler = (req, res) => {
      if (req.url === '/api/tags') {
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({
          models: [
            { name: 'gemma3:4b', size: 3350000000 },
            { name: 'qwen3:8b', size: 5230000000 },
          ],
        }));
        return;
      }
      ndjson(res, [{ message: { content: 'ok' }, done: true }]);
    };

    const local = new OllamaProvider({ name: 'local', baseUrl, models: ['qwen3:8b'] });
    const first = await local.models();
    const second = await local.models();

    assert.deepStrictEqual(first, ['qwen3:8b', 'gemma3:4b'], 'модель из конфига идёт первой');
    assert.deepStrictEqual(second, first);
    assert.strictEqual(hits['/api/tags'], 1, 'второй вызов в пределах TTL не ходит в сеть');

    local.invalidateCache();
    await local.models();
    assert.strictEqual(hits['/api/tags'], 2, 'после сброса кэша — новый запрос');
  });

  test('OLL-4.1: сервер недоступен → модели из конфига, без исключения', async () => {
    const probe = http.createServer(() => undefined);
    const port: number = await new Promise((resolve) => {
      probe.listen(0, '127.0.0.1', () => {
        const address = probe.address() as any;
        probe.close(() => resolve(address.port));
      });
    });
    const dead = new OllamaProvider({ name: 'local', baseUrl: `http://127.0.0.1:${port}`, models: ['qwen3:8b', 'mistral:7b'] });

    const models = await dead.models();
    assert.deepStrictEqual(models, ['qwen3:8b', 'mistral:7b'], 'fallback на конфиг');
    assert.strictEqual(await dead.version(), undefined);
  });

  test('OLL-4.2: /api/show → capabilities, повторный вызов из кэша', async () => {
    handler = (req, res, body) => {
      assert.strictEqual(req.url, '/api/show');
      assert.strictEqual(body.model, 'qwen3:8b');
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ capabilities: ['completion', 'tools', 'thinking'] }));
    };

    const local = new OllamaProvider({ name: 'local', baseUrl, models: [] });
    const caps = await local.capabilities('qwen3:8b');
    const again = await local.capabilities('qwen3:8b');

    assert.deepStrictEqual(caps, { completion: true, embedding: false, tools: true, thinking: true, vision: false });
    assert.deepStrictEqual(again, caps);
    assert.strictEqual(hits['/api/show'], 1, 'capabilities кэшируются');
  });

  test('OLL-4.2: /api/show упал → undefined, без исключения', async () => {
    handler = (_req, res) => {
      res.writeHead(500);
      res.end('boom');
    };
    const local = new OllamaProvider({ name: 'local', baseUrl, models: [] });
    assert.strictEqual(await local.capabilities('qwen3:8b'), undefined);
  });

  test('команда проверки: версия, модели, capabilities одной строкой на модель', async () => {
    handler = (req, res) => {
      if (req.url === '/api/version') {
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ version: '0.40.14' }));
        return;
      }
      if (req.url === '/api/tags') {
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ models: [{ name: 'gemma3:4b', size: 3350000000 }] }));
        return;
      }
      // /api/show
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ capabilities: ['completion', 'vision'] }));
    };

    const lines = await describeLocalServer(new OllamaProvider({ name: 'local', baseUrl, models: [] }));

    assert.match(lines[0], /Ollama 0\.40\.14 · 1 моделей/);
    assert.match(lines[1], /gemma3:4b · 3\.4 ГБ · vision/);
  });

  test('команда проверки: сервер недоступен → подсказка, а не падение', async () => {
    const dead = new OllamaProvider({ name: 'local', baseUrl: 'http://127.0.0.1:1', models: [] });
    // порт 1 недоступен; fetch может быть отфильтрован undici — тогда берём закрытый порт
    const probe = http.createServer(() => undefined);
    const port: number = await new Promise((resolve) => {
      probe.listen(0, '127.0.0.1', () => {
        const address = probe.address() as any;
        probe.close(() => resolve(address.port));
      });
    });
    const closed = new OllamaProvider({ name: 'local', baseUrl: `http://127.0.0.1:${port}`, models: [] });

    for (const provider of [dead, closed]) {
      const lines = await describeLocalServer(provider);
      assert.match(lines.join(' '), /Ollama недоступен/);
      assert.match(lines.join(' '), /туннель/);
    }
  });

  // ─────────── Stage 5: агентский цикл ───────────

  test('OLL-3.1: tool_calls в форме OpenAI, arguments — строка JSON, usage из eval_count', async () => {
    handler = (_req, res) => {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({
        message: {
          role: 'assistant',
          content: '',
          tool_calls: [{ function: { name: 'read_file', arguments: { path: 'src/index.ts' } } }],
        },
        prompt_eval_count: 128,
        eval_count: 24,
        done: true,
      }));
    };

    const response: any = await provider().createWithTools(
      [{ role: 'user', content: 'прочитай файл' }],
      'qwen3:8b',
      [{ type: 'function', function: { name: 'read_file', description: 'чтение', parameters: {} } }],
    );

    const toolCall = response.choices[0].message.tool_calls[0];
    assert.strictEqual(toolCall.type, 'function');
    assert.strictEqual(toolCall.function.name, 'read_file');
    assert.strictEqual(typeof toolCall.function.arguments, 'string', 'AgentWorker парсит arguments как строку');
    assert.deepStrictEqual(JSON.parse(toolCall.function.arguments), { path: 'src/index.ts' });
    assert.match(toolCall.id, /^call_/, 'id синтезируется, у нативного ответа его нет');
    assert.strictEqual(response.usage.prompt_tokens, 128);
    assert.strictEqual(response.usage.completion_tokens, 24);
    assert.strictEqual(captured[0].body.stream, false);
    assert.strictEqual(captured[0].body.tools.length, 1);
  });

  test('OLL-3.2: история агента конвертируется в нативный вид (второй шаг не падает)', async () => {
    handler = (_req, res) => {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ message: { role: 'assistant', content: 'в файле 42 строки' }, done: true }));
    };

    const agentHistory = [
      { role: 'system', content: 'ты агент' },
      { role: 'user', content: 'сколько строк?' },
      {
        role: 'assistant',
        content: '',
        tool_calls: [{ id: 'call_1', type: 'function', function: { name: 'read_file', arguments: '{"path":"a.ts"}' } }],
      },
      { role: 'tool', tool_call_id: 'call_1', content: 'строка1\nстрока2' },
    ];

    const response: any = await provider().createWithTools(agentHistory, 'qwen3:8b', []);
    const sent = captured[0].body.messages;

    assert.strictEqual(sent[2].role, 'assistant');
    assert.deepStrictEqual(sent[2].tool_calls[0].function.arguments, { path: 'a.ts' }, 'строка JSON → объект');
    assert.strictEqual(sent[2].tool_calls[0].id, undefined, 'нативный вид без id/type');
    assert.strictEqual(sent[3].role, 'tool');
    assert.strictEqual(response.choices[0].message.content, 'в файле 42 строки');
    assert.strictEqual(response.choices[0].message.tool_calls, undefined);
  });

  test('OLL-3.2: конвертация — чистые функции, крайние случаи', () => {
    assert.deepStrictEqual(toNativeMessages([
      { role: 'assistant', tool_calls: [{ function: { name: 'a', arguments: 'не json' } }] },
    ])[0].tool_calls[0].function.arguments, {}, 'битый JSON не роняет конвертацию');

    assert.deepStrictEqual(toNativeMessages([{ role: 'tool', tool_call_id: 'x', tool_name: 'read_file', content: 'ok' }])[0],
      { role: 'tool', content: 'ok', tool_name: 'read_file' });

    assert.deepStrictEqual(toOpenAIToolCalls([]), undefined, 'пустой список → undefined');
    assert.deepStrictEqual(toOpenAIToolCalls(undefined), undefined);
  });

  test('OLL-2.1: в агентском шаге пустой content без tool_calls → ошибка про рассуждение', async () => {
    handler = (_req, res) => {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ message: { content: '', thinking: 'думаю…' }, done: true }));
    };

    await assert.rejects(
      () => provider().createWithTools([{ role: 'user', content: 'q' }], 'qwen3:8b', []),
      /рассуждени/i,
    );
  });

  // ─────────── Vision на локальной модели (OLL-5.1) ───────────

  test('OLL-5.1: image_url data-url → нативное images: [base64] без префикса', async () => {
    handler = (_req, res) => ndjson(res, [{ message: { content: 'на картинке кот' }, done: true }]);

    const parts: string[] = [];
    for await (const chunk of provider().chatWithVision(
      [{
        role: 'user',
        content: [
          { type: 'text', text: 'что на картинке?' },
          { type: 'image_url', image_url: { url: 'data:image/png;base64,QUJD' } },
        ],
      }],
      { model: 'gemma3:4b' },
    )) {
      parts.push(chunk);
    }

    assert.deepStrictEqual(parts, ['на картинке кот']);
    const sent = captured[0].body.messages[0];
    assert.deepStrictEqual(sent.images, ['QUJD'], 'префикс data:…;base64, срезан');
    assert.strictEqual(sent.content, 'что на картинке?');
    assert.strictEqual(captured[0].body.think, false);
  });

  test('OLL-5.1: конвертер изображений — крайние случаи', () => {
    assert.deepStrictEqual(
      toNativeVisionMessages([{ role: 'user', content: 'просто текст' }]),
      [{ role: 'user', content: 'просто текст' }],
      'строковый content не трогаем',
    );
    assert.deepStrictEqual(
      toNativeVisionMessages([{ role: 'user', content: [{ type: 'text', text: 'a' }, { type: 'text', text: 'b' }] }])[0],
      { role: 'user', content: 'a\nb' },
      'несколько текстовых частей склеиваются',
    );
    assert.deepStrictEqual(
      toNativeVisionMessages([{ role: 'user', content: [{ type: 'image_url', image_url: { url: 'http://host/img.png' } }] }])[0],
      { role: 'user', content: '', images: ['http://host/img.png'] },
      'url без data-префикса передаётся как есть',
    );
  });

  test('OLL-6.4 (AW-1.3): local.requestTimeout ограничивает ожидание', async () => {
    // Сервер принимает запрос и молчит — поток должен быть прерван по таймауту настройки
    handler = () => undefined;
    localSettings['local.requestTimeout'] = 0.3; // секунды → 300 мс

    const started = Date.now();
    await assert.rejects(async () => {
      for await (const _ of provider().chat([{ role: 'user', content: 'q' }], { model: 'qwen3:8b' })) {
        /* consume */
      }
    });
    const elapsed = Date.now() - started;

    assert.ok(elapsed < 3000, `таймаут сработал быстро (${elapsed} мс), а не по глобальным 60 с`);
  });

  test('OLL-4.1: эмбеддинг-модели не попадают в чат-селектор', async () => {
    handler = (req, res, body) => {
      if (req.url === '/api/tags') {
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({
          models: [
            { name: 'gemma3:4b', size: 3350000000 },
            { name: 'qwen3-embedding:0.6b', size: 640000000 },
          ],
        }));
        return;
      }
      // /api/show: у embedding нет capability completion
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({
        capabilities: body.model === 'qwen3-embedding:0.6b' ? ['embedding'] : ['completion', 'vision'],
      }));
    };

    const models = await new OllamaProvider({ name: 'local', baseUrl, models: [] }).models();

    assert.deepStrictEqual(models, ['gemma3:4b'], 'эмбеддинг отфильтрован, чат-модель осталась');
  });

  test('OLL-4.1: нестандартные capabilities (пустой список) — модель не выбрасываем', async () => {
    handler = (req, res) => {
      if (req.url === '/api/tags') {
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ models: [{ name: 'weird:latest', size: 1 }] }));
        return;
      }
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ capabilities: [] }));
    };

    const models = await new OllamaProvider({ name: 'local', baseUrl, models: [] }).models();
    assert.deepStrictEqual(models, ['weird:latest'], 'пустые capabilities — не повод скрывать модель');
  });

  test('OLL-4.1: если /api/show недоступен — модель не выбрасываем', async () => {
    handler = (req, res) => {
      if (req.url === '/api/tags') {
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ models: [{ name: 'custom:latest', size: 1 }] }));
        return;
      }
      res.writeHead(500);
      res.end('boom');
    };

    const models = await new OllamaProvider({ name: 'local', baseUrl, models: [] }).models();
    assert.deepStrictEqual(models, ['custom:latest'], 'при незнании capabilities модель остаётся');
  });

  /** NDJSON с финальным чанком, несущим prompt_eval_count. */
  function chatWithUsage(promptEvalCount?: number) {
    handler = (_req, res) =>
      ndjson(res, [
        { message: { role: 'assistant', content: 'ок' }, done: false },
        {
          message: { role: 'assistant', content: '' },
          done: true,
          ...(promptEvalCount === undefined ? {} : { prompt_eval_count: promptEvalCount }),
        },
      ]);
  }

  async function drain(p: OllamaProvider, model = 'qwen3:8b'): Promise<void> {
    for await (const _ of p.chat([{ role: 'user', content: 'q' }], { model })) {
      /* consume */
    }
  }

  test('OLL-9.1: prompt_eval_count == num_ctx → предупреждение об обрезке', async () => {
    localSettings['local.numCtx'] = 4096;
    chatWithUsage(4096);

    await drain(provider());

    assert.strictEqual(warnSpy.callCount, 1, 'предупреждение должно быть ровно одно');
    const text = String(warnSpy.firstCall.args[0]);
    assert.match(text, /вероятно, обрезан/);
    assert.match(text, /4096/);
  });

  test('OLL-9.2: prompt_eval_count заметно меньше окна → предупреждения нет', async () => {
    localSettings['local.numCtx'] = 4096;
    chatWithUsage(2950);

    await drain(provider());

    assert.strictEqual(warnSpy.callCount, 0, 'промпт доехал целиком — молчим');
  });

  test('OLL-9.3: предупреждение один раз на модель, другая модель — предупреждает', async () => {
    localSettings['local.numCtx'] = 4096;
    chatWithUsage(4100);
    const p = provider();

    await drain(p, 'qwen3:8b');
    await drain(p, 'qwen3:8b');
    assert.strictEqual(warnSpy.callCount, 1, 'вторая попытка той же модели не дублирует');

    await drain(p, 'gemma3:4b');
    assert.strictEqual(warnSpy.callCount, 2, 'другая модель предупреждает отдельно');
  });

  test('OLL-9.4: debug-строка с фактическим prompt_eval_count пишется на каждый ответ', async () => {
    localSettings['local.numCtx'] = 4096;
    localSettings['debug'] = true;
    const logSpy = sandbox.stub(console, 'log');
    chatWithUsage(4100);

    await drain(provider());
    const lines = logSpy.getCalls().map((c) => String(c.args[0] ?? ''));
    assert.ok(
      lines.some((l) => l.includes('[ollama] prompt_eval_count=4100 num_ctx=4096 model=qwen3:8b')),
      `нет debug-строки: ${lines.join(' | ')}`,
    );

    // Поле отсутствует — пишем "?", предупреждения нет
    logSpy.resetHistory();
    __resetTruncationWarningState();
    warnSpy.resetHistory();
    chatWithUsage(undefined);
    await drain(provider());
    const lines2 = logSpy.getCalls().map((c) => String(c.args[0] ?? ''));
    assert.ok(lines2.some((l) => l.includes('prompt_eval_count=?')), 'отсутствие поля должно быть видно');
    assert.strictEqual(warnSpy.callCount, 0, 'без данных предупреждения нет');
  });
});
