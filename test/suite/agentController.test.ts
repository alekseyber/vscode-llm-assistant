// Тесты для AgentController (apply-режим): подтверждение перед выполнением инструмента.
// Покрывает запрос подтверждения, который раньше в apply-режиме вообще не вызывался.

import 'mocha';
import * as assert from 'assert';
import * as sinon from 'sinon';
import { AgentController } from '../../src/modes/apply/AgentController';
import { Tool, ToolSystem } from '../../src/modes/apply/ToolSystem';
import { LLMProvider } from '../../src/providers/types';

/** Имена инструментов, которые «умеет» тестовый реестр */
const TOOL_NAMES = ['write_file', 'read_file', 'patch_file'];

/** Инструмент-заглушка: реестру нужно только имя, выполнение подменяется на уровне ToolSystem */
function stubTool(name: string): Tool {
  return {
    name,
    description: `заглушка ${name}`,
    parameters: { type: 'object', properties: {} },
    execute: async () => 'ok',
  };
}

/** Провайдер, который отдаёт заранее заданные ответы по очереди */
function fakeProvider(answers: string[]): LLMProvider {
  let i = 0;
  return {
    name: 'fake',
    models: async () => ['test-model'],
    chat: () => {
      const answer = answers[Math.min(i++, answers.length - 1)];
      return (async function* () {
        yield answer;
      })();
    },
  };
}

/** Реестр с подменённым выполнением: агент видит инструменты, а зовётся стаб */
function fakeToolSystem(): { toolSystem: ToolSystem; execute: sinon.SinonStub } {
  const toolSystem = new ToolSystem();
  const execute = sinon.stub(toolSystem, 'execute').resolves('ok');
  sinon.stub(toolSystem, 'getToolsDescription').returns('write_file, read_file, patch_file');
  sinon.stub(toolSystem, 'getTool').callsFake((name: string) =>
    TOOL_NAMES.includes(name) ? stubTool(name) : undefined,
  );
  return { toolSystem, execute };
}

suite('AgentController / подтверждение инструментов', () => {
  test('CNF-1: onConfirm=true → инструмент выполняется', async () => {
    const { toolSystem, execute } = fakeToolSystem();
    const controller = new AgentController(toolSystem);
    const onConfirm = sinon.stub().resolves(true);
    const answers = [
      JSON.stringify({ tool: 'write_file', arguments: { path: 'a.txt', content: 'x' } }),
      'Готово.',
    ];

    const result = await controller.run({
      provider: fakeProvider(answers),
      model: 'test-model',
      task: 'запиши файл',
      onConfirm,
    });

    assert.strictEqual(onConfirm.calledOnce, true, 'подтверждение запрошено один раз');
    assert.strictEqual(onConfirm.firstCall.args[0], 'write_file');
    assert.deepStrictEqual(onConfirm.firstCall.args[1], { path: 'a.txt', content: 'x' });
    assert.strictEqual(execute.calledOnce, true, 'инструмент выполнен после согласия');
    assert.strictEqual(result.answer, 'Готово.');
  });

  test('CNF-2: onConfirm=false → инструмент не выполняется, агент получает отказ', async () => {
    const { toolSystem, execute } = fakeToolSystem();
    const controller = new AgentController(toolSystem);
    const onConfirm = sinon.stub().resolves(false);
    const steps: any[] = [];
    const answers = [
      JSON.stringify({ tool: 'write_file', arguments: { path: 'a.txt', content: 'x' } }),
      'Отменено.',
    ];

    const result = await controller.run({
      provider: fakeProvider(answers),
      model: 'test-model',
      task: 'запиши файл',
      onConfirm,
      onStep: (s) => steps.push(s),
    });

    assert.strictEqual(onConfirm.calledOnce, true);
    assert.strictEqual(execute.called, false, 'инструмент НЕ выполнен при отказе');
    assert.ok(
      steps.some((s) => s.type === 'error' && String(s.message).includes('отклонена')),
      'шаг с отказом попал в лог',
    );
    assert.strictEqual(result.answer, 'Отменено.');
  });

  test('CNF-3: onConfirm не передан → поведение прежнее, инструмент выполняется', async () => {
    const { toolSystem, execute } = fakeToolSystem();
    const controller = new AgentController(toolSystem);
    const answers = [
      JSON.stringify({ tool: 'read_file', arguments: { path: 'a.txt' } }),
      'Готово.',
    ];

    await controller.run({ provider: fakeProvider(answers), model: 'test-model', task: 'прочитай' });
    assert.strictEqual(execute.calledOnce, true);
  });
});
