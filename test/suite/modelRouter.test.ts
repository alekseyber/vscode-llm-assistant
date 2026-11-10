// Тесты P9: авто-выбор модели по сложности, прогноз стоимости и лимит бюджета.
// AC: MR-1..MR-9

import 'mocha';
import * as sinon from 'sinon';
import * as vscode from 'vscode';
import * as assert from 'assert';
import { chooseModel, estimateRequestCost, checkBudget, isComplexTask } from '../../src/modes/chat/ModelRouter';

suite('ModelRouter (P9)', () => {
  let sandbox: sinon.SinonSandbox;
  let settings: Record<string, unknown>;

  setup(() => {
    sandbox = sinon.createSandbox();
    settings = {};
    sandbox.stub(vscode.workspace, 'getConfiguration').returns({
      get: (key: string, def?: unknown) => (key in settings ? settings[key] : def),
      has: () => false,
      inspect: () => undefined,
      update: () => Promise.resolve(),
    } as any);
  });

  teardown(() => sandbox.restore());

  test('MR-1: короткий вопрос при включённой маршрутизации — простая модель', () => {
    settings['routing.auto'] = true;
    settings['routing.simpleModel'] = 'deepseek-flash';
    settings['routing.complexModel'] = 'deepseek-pro';

    const route = chooseModel({ text: 'что такое замыкание?', mode: 'chat', contextTokens: 500 }, 'deepseek-pro');

    assert.strictEqual(route.model, 'deepseek-flash');
    assert.strictEqual(route.complex, false);
    assert.strictEqual(route.auto, true, 'модель выбрана автоматически');
  });

  test('MR-2: агентский режим — сложная модель', () => {
    settings['routing.auto'] = true;
    settings['routing.simpleModel'] = 'deepseek-flash';
    settings['routing.complexModel'] = 'deepseek-pro';

    const route = chooseModel({ text: 'добавь тест', mode: 'agent', contextTokens: 500 }, 'deepseek-flash');

    assert.strictEqual(route.model, 'deepseek-pro');
    assert.match(route.reason, /агентский режим/);
  });

  test('MR-3: маркеры сложности и длинный контекст', () => {
    assert.strictEqual(isComplexTask({ text: 'почему падает тест?', mode: 'chat', contextTokens: 100 }).complex, true);
    assert.strictEqual(isComplexTask({ text: 'привет', mode: 'chat', contextTokens: 7000 }).complex, true);
    assert.strictEqual(isComplexTask({ text: 'привет', mode: 'chat', contextTokens: 100 }).complex, false);
  });

  test('MR-4: маршрутизация выключена или модели не заданы — прежняя логика', () => {
    const off = chooseModel({ text: 'привет', mode: 'chat', contextTokens: 100 }, 'fallback');
    assert.strictEqual(off.model, 'fallback');
    assert.strictEqual(off.auto, false);

    settings['routing.auto'] = true; // но модели пустые
    const empty = chooseModel({ text: 'привет', mode: 'chat', contextTokens: 100 }, 'fallback');
    assert.strictEqual(empty.model, 'fallback');
  });

  test('MR-5: прогноз для локальной модели — ноль', () => {
    const pricing = new Map([['qwen3:8b', { input: 0, output: 0 }]]);
    const estimate = estimateRequestCost(5000, 4096, 'qwen3:8b', pricing);
    assert.strictEqual(estimate.cost, 0);
    assert.ok(estimate.inputTokens === 5000, 'вход берётся из фактического контекста');
  });

  test('MR-6: лимит 0 — проверка выключена', () => {
    assert.deepStrictEqual(checkBudget({ limitUsd: 0, spentUsd: 10 }, 1), { kind: 'off' });
  });

  test('MR-7: прогноз выводит за лимит — превышение с числами', () => {
    const verdict = checkBudget({ limitUsd: 1, spentUsd: 0.9 }, 0.3);
    assert.strictEqual(verdict.kind, 'exceed');
    if (verdict.kind === 'exceed') {
      assert.ok(Math.abs(verdict.overUsd - 0.2) < 1e-9, `перерасход ${verdict.overUsd}`);
    }
  });

  test('MR-8: 80% лимита — предупреждение', () => {
    const verdict = checkBudget({ limitUsd: 1, spentUsd: 0.5 }, 0.35);
    assert.strictEqual(verdict.kind, 'warn');
  });

  test('MR-9: в пределах лимита — тишина', () => {
    assert.strictEqual(checkBudget({ limitUsd: 1, spentUsd: 0.1 }, 0.05).kind, 'ok');
  });
});
