// Страховка от «слепых» заглушек в моке vscode.
// AC: MOCK-1, MOCK-2
//
// История: мок отдавал пустой disposable на onDidChangeConfiguration и EventEmitter.fire()
// без слушателей. Из-за этого дефект «Edit-прогон не появляется в истории» юниты
// не ловили: событие просто не доходило до подписчика.

import 'mocha';
import * as assert from 'assert';
import * as vscode from 'vscode';
import { mockInternals } from '../support/vscode-harness';

suite('Мок vscode: события доставляются', () => {
  test('MOCK-1: onDidChangeConfiguration доходит до подписчика', () => {
    const seen: unknown[] = [];
    const sub = vscode.workspace.onDidChangeConfiguration((event) => seen.push(event));

    mockInternals().fireConfigChange();

    assert.strictEqual(seen.length, 1, 'событие изменения настроек должно доходить до обработчика');
    sub.dispose();

    mockInternals().fireConfigChange();
    assert.strictEqual(seen.length, 1, 'после dispose подписчик не вызывается');
  });

  test('MOCK-2: EventEmitter.fire() вызывает всех подписчиков, dispose снимает', () => {
    const emitter = new vscode.EventEmitter<number>();
    const got: number[] = [];
    const first = emitter.event((value) => got.push(value));
    const second = emitter.event((value) => got.push(value * 10));

    emitter.fire(2);
    assert.deepStrictEqual(got, [2, 20], 'оба подписчика получили значение');

    first.dispose();
    emitter.fire(3);
    assert.deepStrictEqual(got, [2, 20, 30], 'снятый подписчик молчит, второй работает');
    second.dispose();
  });
});
