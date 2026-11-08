// E2E для локальных движков (Extension Host): проверяем то, чего мок дать не может.
// В mocked-раннере НЕ участвует: он собирает только test/suite/*.test.js, а e2e-модули
// лежат в test/suite/e2e/*.e2e.ts и собираются хост-раннером (test/suite/index.ts).
// AC: E2E-1, E2E-2

import 'mocha';
import * as assert from 'assert';
import * as http from 'http';
import * as vscode from 'vscode';
import { ProviderManager } from '../../../src/providers/manager';
import { OllamaProvider, readOllamaLocalSettings } from '../../../src/providers/ollama';

suite('E2E: локальные движки в реальном Extension Host', () => {
  const cfg = () => vscode.workspace.getConfiguration('llmAssistant');
  const saved: Record<string, unknown> = {};

  teardown(async () => {
    for (const [key, value] of Object.entries(saved)) {
      await cfg().update(key, value, vscode.ConfigurationTarget.Global);
    }
  });

  test('E2E-1: настройки из настоящего settings.json доходят до провайдеров и до numCtx', async function () {
    this.timeout(20000);

    saved['providers'] = cfg().get('providers');
    saved['local.numCtx'] = cfg().get('local.numCtx');

    // Ключи пишем так, как их читает плагин: здесь и ловится расхождение с манифестом
    await cfg().update(
      'providers',
      {
        local: { type: 'ollama', baseUrl: 'http://127.0.0.1:11434', title: 'Ollama (локально)', models: ['qwen3:8b'] },
        'local-llamacpp': {
          type: 'openai',
          baseUrl: 'http://127.0.0.1:8080/v1',
          apiKey: '',
          title: 'llama.cpp (локально)',
          models: ['qwen3-8b'],
        },
      },
      vscode.ConfigurationTarget.Global,
    );
    await cfg().update('local.numCtx', 2048, vscode.ConfigurationTarget.Global);

    const manager = new ProviderManager();
    const local = manager.getProvider('local') as OllamaProvider;
    const llamacpp = manager.getProvider('local-llamacpp') as any;

    assert.ok(local, 'провайдер Ollama создан из настоящего конфига');
    assert.ok(llamacpp, 'провайдер llama.cpp (type: openai) создан из настоящего конфига');
    assert.strictEqual(local.isLocal, true);
    assert.strictEqual(llamacpp.isLocal, true, 'локальность по адресу loopback');
    assert.deepStrictEqual(manager.pricingMap.get('qwen3-8b'), { input: 0, output: 0 }, 'цена локального движка 0');
    assert.strictEqual(
      readOllamaLocalSettings().numCtx,
      2048,
      'настоящий settings.json читается по тому же ключу, что и в коде',
    );
  });

  test('E2E-2: запрос к живому HTTP-серверу из хост-процесса и предупреждение об обрезке не ломают прогон', async function () {
    this.timeout(30000);

    saved['local.numCtx'] = saved['local.numCtx'] ?? cfg().get('local.numCtx');
    await cfg().update('local.numCtx', 4096, vscode.ConfigurationTarget.Global);

    // Настоящий сервер: NDJSON, финальный чанк с prompt_eval_count == num_ctx (триггер предупреждения)
    const server = http.createServer((req, res) => {
      req.on('data', () => undefined);
      req.on('end', () => {
        res.writeHead(200, { 'Content-Type': 'application/x-ndjson' });
        res.write(JSON.stringify({ message: { role: 'assistant', content: 'ок' }, done: false }) + '\n');
        res.write(
          JSON.stringify({
            message: { role: 'assistant', content: '' },
            done: true,
            prompt_eval_count: 4096,
            eval_count: 1,
          }) + '\n',
        );
        res.end();
      });
    });
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', () => resolve()));
    const port = (server.address() as any).port;

    try {
      const provider = new OllamaProvider({
        name: 'local',
        baseUrl: `http://127.0.0.1:${port}`,
        models: ['qwen3:8b'],
      });
      let text = '';
      for await (const chunk of provider.chat([{ role: 'user', content: 'привет' }], { model: 'qwen3:8b' })) {
        text += chunk;
      }
      assert.strictEqual(text, 'ок', 'стриминг из хост-процесса дошёл');

      // Второй прогон: разовость предупреждения не должна ронять запрос
      let second = '';
      for await (const chunk of provider.chat([{ role: 'user', content: 'ещё' }], { model: 'qwen3:8b' })) {
        second += chunk;
      }
      assert.strictEqual(second, 'ок', 'повторный запрос тоже проходит');
    } finally {
      await new Promise<void>((resolve) => server.close(() => resolve()));
    }
  });
});
