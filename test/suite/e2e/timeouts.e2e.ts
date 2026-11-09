// E2E-8: таймаут и отказ соединения на живых сокетах.
// Реальный Extension Host, настоящие сокеты, настройка local.requestTimeout из settings.json.
// AC: E2E-8

import 'mocha';
import * as assert from 'assert';
import { OllamaProvider } from '../../../src/providers/ollama';
import { applySettings, SettingsSnapshot } from './helpers/settings';
import { startStub, startBlackhole, closedPortUrl, ndjson } from './helpers/net';

suite('E2E-8: таймауты и отказ соединения (живые сокеты)', () => {
  let snap: SettingsSnapshot | undefined;

  teardown(async () => {
    await snap?.restore();
    snap = undefined;
  });

  async function drain(provider: OllamaProvider): Promise<void> {
    for await (const _ of provider.chat([{ role: 'user', content: 'q' }], { model: 'qwen3:8b' })) {
      /* consume */
    }
  }

  test('E2E-8a: чёрная дыра + requestTimeout=2 → запрос падает быстро, а не висит до 300 с', async function () {
    this.timeout(20000);
    const hole = await startBlackhole();
    snap = await applySettings({ 'local.requestTimeout': 2 });
    const provider = new OllamaProvider({ name: 'local', baseUrl: hole.url, models: ['qwen3:8b'] });

    const started = Date.now();
    try {
      await assert.rejects(() => drain(provider), 'запрос к молчащему порту должен упасть');
      const elapsed = Date.now() - started;
      assert.ok(elapsed < 6000, `падение уложилось в настройку (${elapsed} мс при лимите 2 с)`);
    } finally {
      await hole.close();
    }
  });

  test('E2E-8b: закрытый порт → ECONNREFUSED с подсказкой про намеренный запуск и baseUrl', async function () {
    this.timeout(20000);
    const url = await closedPortUrl();
    const provider = new OllamaProvider({ name: 'local', baseUrl: url, models: ['qwen3:8b'] });

    await assert.rejects(
      () => drain(provider),
      (err: any) => {
        assert.match(String(err.message), /ECONNREFUSED/);
        assert.match(String(err.message), /остановлен намеренно/);
        assert.ok(String(err.message).includes(url), `в тексте ошибки есть baseUrl: ${err.message}`);
        return true;
      },
    );
  });

  test('E2E-8c: сервер поднялся на том же порту — тот же провайдер отвечает без перезагрузки', async function () {
    this.timeout(25000);
    const url = await closedPortUrl();
    const port = Number(new URL(url).port);
    const provider = new OllamaProvider({ name: 'local', baseUrl: url, models: ['qwen3:8b'] });

    await assert.rejects(() => drain(provider), 'пока сервера нет — ошибка');

    const stub = await startStub((_req, res) =>
      ndjson(res, [
        { message: { role: 'assistant', content: 'живой' }, done: false },
        { message: { role: 'assistant', content: '' }, done: true, prompt_eval_count: 5, eval_count: 1 },
      ]),
      port,
    );
    try {
      let text = '';
      for await (const chunk of provider.chat([{ role: 'user', content: 'q' }], { model: 'qwen3:8b' })) {
        text += chunk;
      }
      assert.strictEqual(text, 'живой', 'после подъёма стаба запрос проходит без refresh');
    } finally {
      await stub.close();
    }
  });
});
