// Тесты фактического расхода токенов (P23).
// Живой движок не нужен: локальный OpenAI-совместимый сервер поднимается в тесте.
// AC: OAI-4.1, OAI-4.2

import 'mocha';
import * as sinon from 'sinon';
import * as vscode from 'vscode';
import * as assert from 'assert';
import * as http from 'http';
import { OpenAIProvider } from '../../src/providers/openai';

suite('Фактический расход токенов у OpenAI-совместимого провайдера', () => {
  let sandbox: sinon.SinonSandbox;
  let server: http.Server;
  let baseUrl: string;
  let lastBody: any;

  setup((done) => {
    sandbox = sinon.createSandbox();
    // Настройки плагина в этих тестах не читаем: ретраи и таймауты — дефолты
    sandbox.stub(vscode.workspace, 'getConfiguration').returns({
      get: (_key: string, defaultValue?: unknown) => defaultValue,
      has: () => false,
      inspect: () => undefined,
      update: () => Promise.resolve(),
    } as any);

    server = http.createServer((req, res) => {
      let raw = '';
      req.on('data', (c) => { raw += c; });
      req.on('end', () => {
        lastBody = raw ? JSON.parse(raw) : {};
        res.writeHead(200, { 'Content-Type': 'text/event-stream' });
        res.write(`data: ${JSON.stringify({ choices: [{ delta: { content: 'ок' } }] })}\n\n`);
        // usage приходит только если его попросили (stream_options.include_usage) —
        // так ведут себя и llama.cpp, и vLLM
        if (lastBody?.stream_options?.include_usage) {
          res.write(`data: ${JSON.stringify({ choices: [], usage: { prompt_tokens: 42, completion_tokens: 7 } })}\n\n`);
        }
        res.write('data: [DONE]\n\n');
        res.end();
      });
    });
    server.listen(0, '127.0.0.1', () => {
      baseUrl = `http://127.0.0.1:${(server.address() as any).port}/v1`;
      done();
    });
  });

  teardown((done) => {
    sandbox.restore();
    server.close(() => done());
  });

  function provider(isLocal: boolean): OpenAIProvider {
    return new OpenAIProvider({
      name: isLocal ? 'local-llamacpp' : 'openai',
      baseUrl,
      apiKey: 'test-key',
      models: ['qwen3-8b'],
      isLocal,
      toolLoop: undefined,
    } as any);
  }

  async function drain(p: OpenAIProvider): Promise<any> {
    let got: any;
    for await (const _ of p.chat([{ role: 'user', content: 'q' }], {
      model: 'qwen3-8b',
      stream: true,
      onUsage: (u) => { got = u; },
    })) { /* consume */ }
    return got;
  }

  test('OAI-4.1: у локального движка просим usage и отдаём его вызывающей стороне', async () => {
    const usage = await drain(provider(true));

    assert.strictEqual(lastBody?.stream_options?.include_usage, true, 'usage нужно просить явно');
    assert.deepStrictEqual(usage, { input: 42, output: 7 }, 'цифры сервера, а не оценка');
  });

  test('OAI-4.2: у облачного провайдера лишний параметр не отправляем', async () => {
    const usage = await drain(provider(false));

    assert.strictEqual(lastBody?.stream_options, undefined, 'облако может отвергнуть незнакомое поле');
    assert.strictEqual(usage, undefined, 'остаётся оценка по символам');
  });
});
