// E2E-9: discovery и команда проверки локального сервера на живом стабе.
// AC: E2E-9

import 'mocha';
import * as assert from 'assert';
import * as vscode from 'vscode';
import { OllamaProvider } from '../../../src/providers/ollama';
import { applySettings, SettingsSnapshot } from './helpers/settings';
import { startStub, closedPortUrl, json } from './helpers/net';

suite('E2E-9: discovery и checkLocalServer', () => {
  let snap: SettingsSnapshot | undefined;

  teardown(async () => {
    await snap?.restore();
    snap = undefined;
  });

  /** Стаб Ollama: /api/version, /api/tags, /api/show (embedding-модель без completion). */
  async function ollamaStub() {
    return startStub((req, res, body) => {
      if (req.url === '/api/version') return json(res, { version: '0.40.15' });
      if (req.url === '/api/tags') {
        return json(res, {
          models: [
            { name: 'qwen3:8b', size: 5_228_000_000 },
            { name: 'qwen3-embedding:0.6b', size: 640_000_000 },
          ],
        });
      }
      if (req.url === '/api/show') {
        const model = String(body?.model ?? '');
        const capabilities = model.includes('embedding') ? ['embedding'] : ['completion', 'tools', 'thinking'];
        return json(res, { capabilities, details: {} });
      }
      return json(res, { error: 'not found' }, 404);
    });
  }

  test('E2E-9a: модели из /api/tags, embedding-модель отфильтрована', async function () {
    this.timeout(20000);
    const stub = await ollamaStub();
    try {
      const provider = new OllamaProvider({ name: 'local', baseUrl: stub.url, models: [] });
      const models = await provider.models();
      assert.deepStrictEqual(models, ['qwen3:8b'], 'embedding-модель не попадает в чат-селектор');
    } finally {
      await stub.close();
    }
  });

  test('E2E-9b: команда checkLocalServer отдаёт отчёт по живому стабу и не бросает', async function () {
    this.timeout(30000);
    const stub = await ollamaStub();
    snap = await applySettings({
      providers: { local: { type: 'ollama', baseUrl: stub.url, title: 'Ollama (локально)', models: [] } },
      defaultProvider: 'local',
    });

    const original = vscode.window.showInformationMessage;
    const messages: string[] = [];
    (vscode.window as any).showInformationMessage = async (msg: string) => {
      messages.push(String(msg));
      return undefined;
    };
    try {
      await vscode.commands.executeCommand('llmAssistant.checkLocalServer');
      assert.ok(messages.length > 0, 'команда показала отчёт');
      const report = messages.join('\n');
      assert.match(report, /Ollama/i, 'в отчёте есть версия сервера');
      assert.match(report, /qwen3:8b/, 'в отчёте перечислены модели');
    } finally {
      (vscode.window as any).showInformationMessage = original;
      await stub.close();
    }
  });

  test('E2E-9c: сервер погашен — команда не падает и объясняет, что делать', async function () {
    this.timeout(30000);
    const url = await closedPortUrl();
    snap = await applySettings({
      providers: { local: { type: 'ollama', baseUrl: url, title: 'Ollama (локально)', models: ['qwen3:8b'] } },
      defaultProvider: 'local',
    });

    const original = vscode.window.showInformationMessage;
    const messages: string[] = [];
    (vscode.window as any).showInformationMessage = async (msg: string) => {
      messages.push(String(msg));
      return undefined;
    };
    try {
      await vscode.commands.executeCommand('llmAssistant.checkLocalServer');
      assert.ok(messages.length > 0, 'команда ответила сообщением, а не исключением');
      assert.match(messages.join('\n'), /Ollama|ollama|запущ/i, 'подсказка про сервер');
    } finally {
      (vscode.window as any).showInformationMessage = original;
    }
  });
});
