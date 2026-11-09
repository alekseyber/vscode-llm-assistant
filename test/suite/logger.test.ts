// DEBUG-лог: строки провайдеров должны попадать в канал «LLM Assistant», а не только в консоль.
// AC: LOG-1..LOG-3

import 'mocha';
import * as assert from 'assert';
import * as sinon from 'sinon';
import * as vscode from 'vscode';
import { debugLog, setDebugSink, isDebugEnabled } from '../../src/shared/logger';

suite('DEBUG-лог и канал вывода', () => {
  let sandbox: sinon.SinonSandbox;
  let consoleSpy: sinon.SinonStub;
  let settings: Record<string, unknown>;

  setup(() => {
    sandbox = sinon.createSandbox();
    settings = {};
    const mockConfig = {
      get: (key: string, fallback?: unknown) => (key in settings ? settings[key] : fallback),
      has: () => false,
      update: async () => undefined,
    };
    sandbox.stub(vscode.workspace, 'getConfiguration').returns(mockConfig as any);
    consoleSpy = sandbox.stub(console, 'log');
  });

  teardown(() => {
    setDebugSink(undefined);
    sandbox.restore();
  });

  test('LOG-1: debug выключен — ни консоли, ни канала', () => {
    const lines: string[] = [];
    setDebugSink({ appendLine: (value: string) => lines.push(value) });

    assert.strictEqual(isDebugEnabled(), false);
    debugLog('[ollama] prompt_eval_count=258 num_ctx=512 model=qwen3:8b');

    assert.strictEqual(consoleSpy.callCount, 0, 'в консоль ничего не пишем без debug');
    assert.deepStrictEqual(lines, [], 'и в канал тоже');
  });

  test('LOG-2: debug включён — строка идёт в консоль и в подключённый канал', () => {
    settings['debug'] = true;
    const lines: string[] = [];
    setDebugSink({ appendLine: (value: string) => lines.push(value) });

    debugLog('[ollama] prompt_eval_count=258 num_ctx=512 model=qwen3:8b');

    assert.strictEqual(consoleSpy.callCount, 1, 'в консоли строка есть');
    assert.strictEqual(lines.length, 1, 'в канале строка тоже есть');
    assert.match(lines[0], /prompt_eval_count=258/, 'канал получает текст провайдера');
    assert.match(lines[0], /^\[DEBUG\] /, 'префикс совпадает с остальными строками канала');
  });

  test('LOG-3: канал закрыт или бросает — лог не падает', () => {
    settings['debug'] = true;
    setDebugSink({
      appendLine: () => {
        throw new Error('канал уже закрыт');
      },
    });

    assert.doesNotThrow(() => debugLog('[ollama] проверка'), 'падение канала не должно ломать запрос');
    assert.strictEqual(consoleSpy.callCount, 1, 'строка всё равно попала в консоль');

    setDebugSink(undefined);
    assert.doesNotThrow(() => debugLog('[ollama] без канала'), 'без sink тоже не падаем');
  });
});
