// Смоук активации: расширение должно активироваться без исключений.
// Ловит TDZ/порядок инициализации (переменная прочитана до присваивания) — именно так
// сломался 0.14.33: EditController создавался раньше runHistoryStore.

import 'mocha';
import * as assert from 'assert';
import * as sinon from 'sinon';
import * as vscode from 'vscode';

suite('активация расширения', () => {
  test('ACT-1: activate() не бросает при пустом workspace', async () => {
    const ext = require('../../src/extension');
    assert.strictEqual(typeof ext.activate, 'function');

    const subscriptions: any[] = [];
    const context: any = {
      subscriptions: { push: (...items: any[]) => { subscriptions.push(...items); return items.length; } },
      extensionUri: { fsPath: '/tmp', toString: () => 'file:///tmp' },
      workspaceState: { get: () => undefined, update: async () => undefined },
      globalState: { get: () => undefined, update: async () => undefined },
      extensionPath: '/tmp',
    };

    // activate() ловит исключения внутри и показывает их через showErrorMessage —
    // поэтому проверяем не только throw, но и то, что ошибка не была проглочена
    const sb = sinon.createSandbox();
    const errSpy = sb.stub(vscode.window, 'showErrorMessage').returns(undefined as any);
    const warnSpy = sb.stub(vscode.window, 'showWarningMessage').returns(undefined as any);
    try {
      await ext.activate(context);
    } catch (e: any) {
      sb.restore();
      assert.fail(`activate() упал: ${e && e.message}`);
    }
    const errors = errSpy.getCalls().map((c: any) => String(c.args[0]));
    sb.restore();

    assert.deepStrictEqual(errors, [], `activate() сообщил об ошибке: ${JSON.stringify(errors)}`);
    assert.ok(subscriptions.length > 0, 'подписки зарегистрированы');
  });
});
