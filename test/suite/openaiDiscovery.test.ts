// Тесты discovery моделей OpenAI-совместимого провайдера (P21).
// Живой llama-server не нужен: сервер поднимается внутри теста.
// AC: OAI-3.1, OAI-3.2, OAI-3.3, OAI-3.4

import 'mocha';
import * as sinon from 'sinon';
import * as vscode from 'vscode';
import * as assert from 'assert';
import * as http from 'http';
import { AddressInfo } from 'net';
import { fakeConfiguration } from '../support/vscode-harness';
import { OpenAIProvider } from '../../src/providers/openai';

suite('Discovery моделей у локального OpenAI-совместимого провайдера', () => {
  let sandbox: sinon.SinonSandbox;
  let server: http.Server;
  let baseUrl: string;
  let hits = 0;
  let respond: (res: http.ServerResponse) => void;

  setup((done) => {
    sandbox = sinon.createSandbox();
    sandbox.stub(vscode.workspace, 'getConfiguration').returns(
      fakeConfiguration((_key, defaultValue) => defaultValue),
    );
    hits = 0;
    server = http.createServer((req, res) => {
      hits += 1;
      if ((req.url ?? '').startsWith('/v1/models')) {
        respond(res);
        return;
      }
      res.writeHead(404);
      res.end();
    });
    server.listen(0, '127.0.0.1', () => {
      baseUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}/v1`;
      done();
    });
  });

  teardown((done) => {
    sandbox.restore();
    server.close(() => done());
  });

  function provider(isLocal: boolean, models: string[] = ['qwen3-8b']): OpenAIProvider {
    return new OpenAIProvider({
      name: isLocal ? 'local-llamacpp' : 'openai',
      baseUrl,
      apiKey: '',
      models,
      isLocal,
      toolLoop: undefined,
    });
  }

  const json = (res: http.ServerResponse, body: any, status = 200) => {
    res.writeHead(status, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify(body));
  };

  test('OAI-3.1: локальный движок — модели из /v1/models, конфиг первым, без дублей', async () => {
    respond = (res) => json(res, { object: 'list', data: [{ id: 'qwen3-8b' }, { id: 'gemma3-4b' }] });

    const models = await provider(true).models();

    assert.deepStrictEqual(models, ['qwen3-8b', 'gemma3-4b'], 'конфиг первым, новые из сервера следом');
    assert.strictEqual(hits, 1, 'запрос к /v1/models был');
  });

  test('OAI-3.2: сервер ответил ошибкой или недоступен — конфиг, без исключения', async () => {
    respond = (res) => json(res, { error: 'boom' }, 500);
    assert.deepStrictEqual(await provider(true).models(), ['qwen3-8b'], '500 → конфиг');

    server.close();
    assert.deepStrictEqual(await provider(true).models(), ['qwen3-8b'], 'сервер погашен → конфиг');
  });

  test('OAI-3.3: облачный провайдер не ходит в /v1/models и не подменяет набор', async () => {
    respond = (res) => json(res, { object: 'list', data: [{ id: 'server-model' }] });

    const models = await provider(false, ['gpt-4o']).models();

    assert.deepStrictEqual(models, ['gpt-4o'], 'облачный список остаётся из конфига');
    assert.strictEqual(hits, 0, 'запроса к серверу не было');
  });

  test('OAI-3.4: кэш 30 с — повторный вызов не дёргает сервер', async () => {
    respond = (res) => json(res, { object: 'list', data: [{ id: 'qwen3-8b' }] });
    const p = provider(true);

    await p.models();
    await p.models();

    assert.strictEqual(hits, 1, 'второй вызов обслужен кэшем');
  });
});
