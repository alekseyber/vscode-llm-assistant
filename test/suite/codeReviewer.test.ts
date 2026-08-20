// Тесты CodeReviewer — standalone AI-ревью (мок AgentWorker, без реальных LLM-вызовов)

import 'mocha';
import * as assert from 'assert';
import * as sinon from 'sinon';
import { CodeReviewer } from '../../src/modes/review/CodeReviewer';
import { AgentWorker } from '../../src/modes/apply/AgentWorker';

suite('CodeReviewer', () => {
  let sandbox: sinon.SinonSandbox;
  let reviewer: CodeReviewer;
  let runStub: sinon.SinonStub;

  setup(() => {
    sandbox = sinon.createSandbox();
    reviewer = new CodeReviewer();
    runStub = sandbox.stub(AgentWorker.prototype, 'run').resolves({
      answer: '# Отчёт\n🔴 критично: SQL-инъекция',
      steps: [],
      iterations: 3,
      inputTokens: 100,
      outputTokens: 50,
      cost: 0.0001,
    });
  });

  teardown(() => sandbox.restore());

  test('reviewFile: передаёт путь в задачу и возвращает отчёт (CR-1)', async () => {
    const result = await reviewer.reviewFile('/tmp/a.ts', {}, 'test-model');

    assert.ok(runStub.calledOnce, 'AgentWorker.run вызван');
    const task = runStub.firstCall.args[0];
    assert.ok(task.includes('/tmp/a.ts'), 'задача содержит путь файла');
    assert.strictEqual(result.report, '# Отчёт\n🔴 критично: SQL-инъекция');
    assert.strictEqual(result.iterations, 3);
    assert.strictEqual(result.cost, 0.0001);
  });

  test('reviewCode: передаёт код в задачу, в markdown-фенсе (CR-2)', async () => {
    await reviewer.reviewCode('const x = 1', 'typescript', '/tmp/a.ts', {}, 'test-model');

    const task = runStub.firstCall.args[0];
    assert.ok(task.includes('const x = 1'), 'задача содержит код');
    assert.ok(task.includes('```typescript'), 'код обёрнут в фенс');
  });

  test('пустой код → ранняя ошибка без вызова LLM (CR-4)', async () => {
    const result = await reviewer.reviewCode('   ', 'ts', '/tmp/a.ts', {}, 'test-model');

    assert.strictEqual(result.report, 'Ошибка: нет кода для ревью');
    assert.ok(runStub.notCalled, 'AgentWorker не вызван');
  });

  test('пустой путь → ранняя ошибка без вызова LLM (CR-4)', async () => {
    const result = await reviewer.reviewFile('  ', {}, 'test-model');

    assert.ok(result.report.includes('путь'), 'сообщение об ошибке пути');
    assert.ok(runStub.notCalled, 'AgentWorker не вызван');
  });
});
