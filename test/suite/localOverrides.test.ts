// Тесты приоритета локальных настроек (P18.1): запись провайдера → глобальная → дефолт.
// AC: OVL-1, OVL-2, OVL-3

import 'mocha';
import * as sinon from 'sinon';
import * as vscode from 'vscode';
import * as assert from 'assert';
import { readOllamaLocalSettings } from '../../src/providers/ollama';

suite('Переопределения локальных настроек (providers.<name>.*)', () => {
  let sandbox: sinon.SinonSandbox;

  function stubGlobals(values: Record<string, unknown>): void {
    sandbox.stub(vscode.workspace, 'getConfiguration').returns({
      get: (key: string, defaultValue?: unknown) => (key in values ? values[key] : defaultValue),
      has: () => false,
      inspect: () => undefined,
      update: () => Promise.resolve(),
    } as any);
  }

  setup(() => {
    sandbox = sinon.createSandbox();
  });

  teardown(() => {
    sandbox.restore();
  });

  test('OVL-1: override побеждает глобальную настройку', () => {
    stubGlobals({ 'local.numCtx': 8192, 'local.think': false, 'local.requestTimeout': 300, 'local.toolLoop': false });

    const resolved = readOllamaLocalSettings({ numCtx: 4096, think: true, timeout: 30, toolLoop: true });

    assert.strictEqual(resolved.numCtx, 4096);
    assert.strictEqual(resolved.think, true);
    assert.strictEqual(resolved.requestTimeoutMs, 30_000, 'timeout в записи — в секундах');
    assert.strictEqual(resolved.toolLoop, true);
  });

  test('OVL-2: без override берётся глобальная настройка', () => {
    stubGlobals({ 'local.numCtx': 2048, 'local.think': true, 'local.requestTimeout': 120, 'local.toolLoop': true });

    const resolved = readOllamaLocalSettings();

    assert.strictEqual(resolved.numCtx, 2048);
    assert.strictEqual(resolved.think, true);
    assert.strictEqual(resolved.requestTimeoutMs, 120_000);
    assert.strictEqual(resolved.toolLoop, true);
  });

  test('OVL-3: невалидный override игнорируется, а не ломает запрос', () => {
    stubGlobals({ 'local.numCtx': 8192, 'local.requestTimeout': 300 });

    const resolved = readOllamaLocalSettings({ numCtx: 0, timeout: Number.NaN });

    assert.strictEqual(resolved.numCtx, 8192, 'ноль не должен обнулять окно');
    assert.strictEqual(resolved.requestTimeoutMs, 300_000, 'NaN не должен обнулять таймаут');
  });
});
