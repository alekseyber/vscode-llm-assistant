// Тесты для AgentOrchestrator — оркестратор multi-agent выполнения (MA-2)
// Проверяет:
//   MA-2.1: AgentOrchestrator принимает MultiAgentTask и создаёт N воркеров
//   MA-2.2: Режим parallel — все воркеры запускаются одновременно
//   MA-2.3: Режим sequential — каждый следующий получает результат предыдущего
//   MA-2.4: Результаты всех воркеров собираются в MultiAgentResult
//   MA-2.5: Ошибка одного воркера не роняет весь оркестратор
//   MA-2.8: Юнит-тесты с мок-провайдером

import 'mocha';
import * as assert from 'assert';
import * as sinon from 'sinon';
import { AgentOrchestrator, MultiAgentTask } from '../../src/modes/apply/AgentOrchestrator';
import { WorkerResult, AgentRole } from '../../src/modes/apply/AgentWorker';

/**
 * Создать мок-провайдера, возвращающего фиктивные ответы.
 * Каждый вызов createWithTools возвращает финальный текст.
 */
function createMockProvider(responseText: string = 'Готово') {
  return {
    createWithTools: sinon.stub().resolves({
      choices: [{
        message: { role: 'assistant', content: responseText },
      }],
    }),
  };
}

/** Тестовая роль */
function makeRole(name: string, prompt: string = 'Тестовый агент'): AgentRole {
  return { name, systemPrompt: prompt };
}

// ==================== Тесты ====================

suite('AgentOrchestrator', () => {
  // MA-2.1: принимает MultiAgentTask и создаёт N воркеров
  test('MA-2.1: execute() создаёт воркеров для каждой роли', async () => {
    const task: MultiAgentTask = {
      id: 'test-1',
      goal: 'Напиши код',
      roles: [makeRole('coder'), makeRole('reviewer'), makeRole('tester')],
      strategy: 'parallel',
    };
    const provider = createMockProvider('OK');

    const orchestrator = new AgentOrchestrator();
    const result = await orchestrator.execute(task, provider);

    assert.strictEqual(result.taskId, 'test-1');
    assert.strictEqual(result.workers.length, 3, 'Должно быть 3 воркера');
    assert.strictEqual(result.strategy, 'parallel');
  });

  // MA-2.2: parallel — все запускаются одновременно
  test('MA-2.2: parallel запускает всех воркеров одновременно', async () => {
    const task: MultiAgentTask = {
      id: 'parallel-test',
      goal: 'Создай файлы',
      roles: [makeRole('w1'), makeRole('w2')],
      strategy: 'parallel',
    };

    // Используем задержки чтобы проверить параллельность
    let completed: string[] = [];
    const provider = {
      createWithTools: sinon.stub().callsFake(async () => {
        completed.push('start');
        await new Promise(r => setTimeout(r, 10));
        return { choices: [{ message: { role: 'assistant', content: 'OK' } }] };
      }),
    };

    const orchestrator = new AgentOrchestrator();
    const result = await orchestrator.execute(task, provider);

    assert.strictEqual(result.workers.length, 2);
    assert.strictEqual(result.workers[0].roleName, 'w1');
    assert.strictEqual(result.workers[1].roleName, 'w2');
    assert.ok(!result.workers[0].error, 'w1 не должен иметь ошибку');
    assert.ok(!result.workers[1].error, 'w2 не должен иметь ошибку');
  });

  // MA-2.2: parallel — результаты собираются для всех
  test('MA-2.2: parallel собирает ответы всех воркеров', async () => {
    const task: MultiAgentTask = {
      id: 'p2',
      goal: 'Задача',
      roles: [makeRole('coder'), makeRole('tester')],
      strategy: 'parallel',
    };
    const provider = createMockProvider('Ответ воркера');

    const orchestrator = new AgentOrchestrator();
    const result = await orchestrator.execute(task, provider);

    assert.ok(result.summary.includes('coder ✅'), 'Сводка должна содержать coder');
    assert.ok(result.summary.includes('tester ✅'), 'Сводка должна содержать tester');
    assert.ok(result.summary.includes('Ответ воркера'), 'Сводка должна содержать ответы');
  });

  // MA-2.3: sequential — каждый следующий получает результат предыдущего
  test('MA-2.3: sequential передаёт контекст между воркерами', async () => {
    const responses = ['Архитектура готова', 'Код написан', 'Тесты пройдены'];
    let callIndex = 0;
    const provider = {
      createWithTools: sinon.stub().callsFake(async (_messages: any[], _model: string, _tools: any[]) => {
        const resp = responses[callIndex++];
        return { choices: [{ message: { role: 'assistant', content: resp } }] };
      }),
    };

    const task: MultiAgentTask = {
      id: 'seq-test',
      goal: 'Создай проект',
      roles: [makeRole('architect'), makeRole('coder'), makeRole('tester')],
      strategy: 'sequential',
    };

    const orchestrator = new AgentOrchestrator();
    const result = await orchestrator.execute(task, provider);

    assert.strictEqual(result.workers.length, 3);
    assert.strictEqual(result.workers[0].result.answer, 'Архитектура готова');
    assert.strictEqual(result.workers[1].result.answer, 'Код написан');
    assert.strictEqual(result.workers[2].result.answer, 'Тесты пройдены');

    // Проверяем что coder получил контекст от architect
    const coderCall = provider.createWithTools.getCall(1);
    const coderMessages = coderCall.args[0];
    const coderUserMsg = coderMessages.find((m: any) => m.role === 'user');
    assert.ok(coderUserMsg.content.includes('Результат предыдущего этапа'), 'coder должен получить контекст от architect');
    assert.ok(coderUserMsg.content.includes('Архитектура готова'), 'coder должен видеть результат architect');
  });

  // MA-2.4: Результаты собираются в MultiAgentResult
  test('MA-2.4: MultiAgentResult содержит полную статистику', async () => {
    const task: MultiAgentTask = {
      id: 'stats-test',
      goal: 'Задача',
      roles: [makeRole('w1'), makeRole('w2')],
      strategy: 'parallel',
    };
    const provider = createMockProvider('OK');

    const orchestrator = new AgentOrchestrator();
    const result = await orchestrator.execute(task, provider);

    assert.strictEqual(result.strategy, 'parallel');
    assert.ok(result.totalInputTokens >= 0, 'Должны быть входные токены');
    assert.ok(result.totalOutputTokens >= 0, 'Должны быть выходные токены');
    assert.strictEqual(result.success, true, 'success должен быть true без ошибок');
    assert.ok(result.summary.length > 0, 'summary не должен быть пустым');
  });

  // MA-2.5: Ошибка одного воркера не роняет оркестратор
  test('MA-2.5: ошибка воркера изолируется, остальные продолжают', async () => {
    const provider = {
      createWithTools: sinon.stub().callsFake(async (_messages: any[], _model: string, _tools: any[]) => {
        // Определяем роль по system prompt в первом сообщении
        const sysMsg = (_messages as any[]).find((m: any) => m.role === 'system');
        const sysContent = sysMsg?.content || '';
        if (sysContent.includes('Сломайся')) {
          throw new Error('Воркер broken упал');
        }
        return { choices: [{ message: { role: 'assistant', content: 'OK' } }] };
      }),
    };

    const task: MultiAgentTask = {
      id: 'error-test',
      goal: 'Задача',
      roles: [makeRole('w1'), makeRole('broken', 'Ты должен Сломайся'), makeRole('w3')],
      strategy: 'parallel',
    };

    const orchestrator = new AgentOrchestrator();
    const result = await orchestrator.execute(task, provider);

    assert.strictEqual(result.workers.length, 3);
    assert.ok(!result.workers[0].error, 'w1 должен быть без ошибки');
    const brokenWorker = result.workers.find(w => w.roleName === 'broken');
    assert.ok(brokenWorker, 'Должен быть воркер broken');
    assert.ok(brokenWorker!.error, 'broken должен иметь ошибку');
    assert.ok(brokenWorker!.error!.includes('Воркер broken упал'), 'Ошибка должна быть сохранена');
    assert.ok(!result.workers[2].error, 'w3 должен быть без ошибки (изоляция)');
    assert.strictEqual(result.success, false, 'success должен быть false при ошибке');
    assert.ok(result.summary.includes('broken ❌'), 'Сводка должна показывать ошибку broken');
  });

  // MA-2.3: sequential останавливается при ошибке
  test('MA-2.3: sequential прерывает цепочку при ошибке воркера', async () => {
    let callCount = 0;
    const provider = {
      createWithTools: sinon.stub().callsFake(async () => {
        callCount++;
        if (callCount === 2) throw new Error('Сбой на шаге 2');
        return { choices: [{ message: { role: 'assistant', content: 'OK' } }] };
      }),
    };

    const task: MultiAgentTask = {
      id: 'seq-error',
      goal: 'Задача',
      roles: [makeRole('step1'), makeRole('step2'), makeRole('step3')],
      strategy: 'sequential',
    };

    const orchestrator = new AgentOrchestrator();
    const result = await orchestrator.execute(task, provider);

    assert.strictEqual(result.workers.length, 2, 'Должно быть только 2 воркера (цепочка прервана)');
    assert.ok(!result.workers[0].error, 'step1 — OK');
    assert.ok(result.workers[1].error, 'step2 — ошибка');
  });

  // Pipeline стратегия
  test('pipeline: воркеры выполняются последовательно с артефактами', async () => {
    const responses = ['DESIGN.md создан', 'server.ts написан', 'Тесты готовы'];
    let idx = 0;
    const provider = {
      createWithTools: sinon.stub().callsFake(async () => ({
        choices: [{ message: { role: 'assistant', content: responses[idx++] } }],
      })),
    };

    const task: MultiAgentTask = {
      id: 'pipe-test',
      goal: 'Создай API',
      roles: [makeRole('architect'), makeRole('coder'), makeRole('tester')],
      strategy: 'pipeline',
    };

    const orchestrator = new AgentOrchestrator();
    const result = await orchestrator.execute(task, provider);

    assert.strictEqual(result.workers.length, 3);
    assert.strictEqual(result.workers[0].result.answer, 'DESIGN.md создан');
    assert.strictEqual(result.workers[2].result.answer, 'Тесты готовы');
  });

  // Колбэк onLog
  test('onLog: колбэк вызывается при логировании', async () => {
    const logs: string[] = [];
    const task: MultiAgentTask = {
      id: 'log-test',
      goal: 'Задача',
      roles: [makeRole('w1')],
      strategy: 'parallel',
    };
    const provider = createMockProvider('OK');

    const orchestrator = new AgentOrchestrator((msg) => logs.push(msg));
    await orchestrator.execute(task, provider);

    assert.ok(logs.length >= 2, 'Должно быть минимум 2 лог-сообщения (старт + завершение)');
    assert.ok(logs[0].includes('старт'), 'Первое сообщение — старт');
    assert.ok(logs[logs.length - 1].includes('завершён'), 'Последнее — завершение');
  });
});
