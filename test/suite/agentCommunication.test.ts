// Тесты для коммуникации между агентами — MA-3
// Проверяет:
//   MA-3.1: Воркер может прочитать результат другого воркера (SharedContext)
//   MA-3.2: Sequential — результат воркера N передаётся воркеру N+1 (уже в MA-2)
//   MA-3.3: Pipeline — каждый воркер работает над своим артефактом (уже в MA-2)

import 'mocha';
import * as assert from 'assert';
import * as sinon from 'sinon';
import { AgentOrchestrator, MultiAgentTask } from '../../src/modes/apply/AgentOrchestrator';
import { AgentRole } from '../../src/modes/apply/AgentWorker';
import { AgentSharedContext, SharedArtifact } from '../../src/modes/apply/AgentSharedContext';

function makeRole(name: string, prompt: string = 'Тестовый агент'): AgentRole {
  return { name, systemPrompt: prompt };
}

function makeProvider(response: string = 'OK') {
  return {
    createWithTools: sinon.stub().resolves({
      choices: [{ message: { role: 'assistant', content: response } }],
    }),
  };
}

// ==================== Тесты ====================

suite('AgentSharedContext', () => {
  test('put/get: артефакт сохраняется и читается', () => {
    const ctx = new AgentSharedContext();
    ctx.put('design.md', '# Архитектура', 'architect');

    const artifact = ctx.get('design.md');
    assert.ok(artifact, 'Артефакт должен быть найден');
    assert.strictEqual(artifact!.key, 'design.md');
    assert.strictEqual(artifact!.content, '# Архитектура');
    assert.strictEqual(artifact!.createdBy, 'architect');
  });

  test('list: возвращает артефакты в хронологическом порядке', () => {
    const ctx = new AgentSharedContext();
    ctx.put('a', 'первый', 'w1');
    ctx.put('b', 'второй', 'w2');

    const items = ctx.list();
    assert.strictEqual(items.length, 2);
    assert.strictEqual(items[0].key, 'a');
    assert.strictEqual(items[1].key, 'b');
  });

  test('listByRole: фильтрует по роли', () => {
    const ctx = new AgentSharedContext();
    ctx.put('a', 'от w1', 'w1');
    ctx.put('b', 'от w2', 'w2');
    ctx.put('c', 'тоже w1', 'w1');

    const w1Items = ctx.listByRole('w1');
    assert.strictEqual(w1Items.length, 2);
    assert.ok(w1Items.every(a => a.createdBy === 'w1'));
  });

  test('summary: форматирует все артефакты', () => {
    const ctx = new AgentSharedContext();
    ctx.put('readme.md', '# Проект', 'architect');

    const s = ctx.summary();
    assert.ok(s.includes('readme.md'));
    assert.ok(s.includes('architect'));
    assert.ok(s.includes('# Проект'));
  });

  test('get несуществующего ключа — undefined', () => {
    const ctx = new AgentSharedContext();
    assert.strictEqual(ctx.get('nonexistent'), undefined);
  });

  test('пустой sharedContext — пустой список', () => {
    const ctx = new AgentSharedContext();
    assert.strictEqual(ctx.list().length, 0);
    assert.strictEqual(ctx.summary(), '(нет артефактов)');
  });
});

suite('AgentOrchestrator — SharedContext интеграция', () => {
  // MA-3.1: Воркеры сохраняют результаты в SharedContext
  test('MA-3.1: parallel — результаты всех воркеров в SharedContext', async () => {
    const task: MultiAgentTask = {
      id: 'shared-test',
      goal: 'Создай файлы',
      roles: [makeRole('coder'), makeRole('tester')],
      strategy: 'parallel',
    };
    const provider = makeProvider('Готово');

    const orchestrator = new AgentOrchestrator();
    await orchestrator.execute(task, provider);

    // Проверяем что результаты сохранены в SharedContext
    const coderResult = orchestrator.sharedContext.get('result:coder');
    const testerResult = orchestrator.sharedContext.get('result:tester');

    assert.ok(coderResult, 'Результат coder должен быть в SharedContext');
    assert.strictEqual(coderResult!.content, 'Готово');
    assert.strictEqual(coderResult!.createdBy, 'coder');

    assert.ok(testerResult, 'Результат tester должен быть в SharedContext');
    assert.strictEqual(testerResult!.content, 'Готово');
  });

  // MA-3.1: Воркер может прочитать результат другого воркера
  test('MA-3.1: sequential — следующий воркер видит SharedContext предыдущего', async () => {
    const responses = ['План готов', 'Код написан'];
    let idx = 0;
    const provider = {
      createWithTools: sinon.stub().callsFake(async () => ({
        choices: [{ message: { role: 'assistant', content: responses[idx++] } }],
      })),
    };

    const task: MultiAgentTask = {
      id: 'ctx-seq',
      goal: 'Напиши проект',
      roles: [makeRole('architect'), makeRole('coder')],
      strategy: 'sequential',
    };

    const orchestrator = new AgentOrchestrator();
    const result = await orchestrator.execute(task, provider);

    // Architect сохранил свой результат
    const archResult = orchestrator.sharedContext.get('result:architect');
    assert.strictEqual(archResult!.content, 'План готов');

    // Coder сохранил свой результат
    const coderResult = orchestrator.sharedContext.get('result:coder');
    assert.strictEqual(coderResult!.content, 'Код написан');

    // Coder получил контекст от architect (проверяем что это работает через sequential)
    const coderCall = provider.createWithTools.getCall(1);
    const coderMessages = coderCall.args[0];
    const coderUserMsg = coderMessages.find((m: any) => m.role === 'user');
    assert.ok(coderUserMsg.content.includes('Результат предыдущего этапа'), 'Sequential контекст передан');
  });

  // MA-3.3: Pipeline сохраняет артефакты
  test('MA-3.3: pipeline — артефакты сохраняются в SharedContext', async () => {
    const responses = ['DESIGN.md', 'server.ts', 'test.ts'];
    let idx = 0;
    const provider = {
      createWithTools: sinon.stub().callsFake(async () => ({
        choices: [{ message: { role: 'assistant', content: responses[idx++] } }],
      })),
    };

    const task: MultiAgentTask = {
      id: 'pipe-ctx',
      goal: 'Создай API',
      roles: [makeRole('architect'), makeRole('coder'), makeRole('tester')],
      strategy: 'pipeline',
    };

    const orchestrator = new AgentOrchestrator();
    await orchestrator.execute(task, provider);

    const artifacts = orchestrator.sharedContext.list();
    assert.strictEqual(artifacts.length, 3);
    assert.strictEqual(artifacts[0].content, 'DESIGN.md');
    assert.strictEqual(artifacts[1].content, 'server.ts');
    assert.strictEqual(artifacts[2].content, 'test.ts');

    // Проверяем что pipeline воркеры видят артефакты предыдущих
    const coderCall = provider.createWithTools.getCall(1);
    const coderMessages = coderCall.args[0];
    const coderUser = coderMessages.find((m: any) => m.role === 'user');
    assert.ok(coderUser.content.includes('Артефакты предыдущих этапов'), 'Pipeline: артефакты переданы');
  });

  // listByRole после оркестрации
  test('listByRole: фильтрация по роли после оркестрации', async () => {
    const task: MultiAgentTask = {
      id: 'filter-test',
      goal: 'Задача',
      roles: [makeRole('coder'), makeRole('reviewer')],
      strategy: 'parallel',
    };
    const provider = makeProvider('OK');

    const orchestrator = new AgentOrchestrator();
    await orchestrator.execute(task, provider);

    const coderArtifacts = orchestrator.sharedContext.listByRole('coder');
    const reviewerArtifacts = orchestrator.sharedContext.listByRole('reviewer');

    assert.strictEqual(coderArtifacts.length, 1);
    assert.strictEqual(reviewerArtifacts.length, 1);
    assert.strictEqual(coderArtifacts[0].key, 'result:coder');
    assert.strictEqual(reviewerArtifacts[0].key, 'result:reviewer');
  });
});
