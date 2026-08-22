// Тесты для AgentWorker — изолированный ReAct-агент для multi-agent оркестрации (MA-1)
// Проверяет:
//   MA-1.1: AgentWorker принимает AgentRole и создаёт изолированный контекст
//   MA-1.2: Воркер использует свой systemPrompt
//   MA-1.3: allowedTools ограничивает доступные инструменты
//   MA-1.4: Можно указать отдельную модель для воркера
//   MA-1.5: AgentWorker.run(task) возвращает {answer, steps, tokens}
//   MA-1.8: Юнит-тесты с мок-провайдером

import 'mocha';
import * as assert from 'assert';
import * as sinon from 'sinon';
import { AgentWorker, AgentRole } from '../../src/modes/apply/AgentWorker';

/**
 * Создать мок-провайдера для тестов.
 * Возвращает фиктивные ответы: сначала tool_call, потом финальный ответ.
 */
function createMockProvider(responses: any[] = []) {
  let callCount = 0;
  return {
    createWithTools: sinon.stub().callsFake(async (_messages: any[], _model: string, _tools: any[]) => {
      const resp = responses[callCount] || responses[responses.length - 1];
      callCount++;
      return resp;
    }),
  };
}

/** Мок-провайдер: сразу возвращает финальный ответ (без tool calls) */
function mockTextResponse(content: string) {
  return {
    choices: [{
      message: { role: 'assistant', content },
    }],
    usage: { prompt_tokens: 10, completion_tokens: 5, total_tokens: 15 },
  };
}

/** Мок-провайдер: возвращает tool call */
function mockToolCallResponse(toolName: string, args: Record<string, unknown> = {}) {
  return {
    choices: [{
      message: {
        role: 'assistant',
        tool_calls: [{
          id: 'call_1',
          function: { name: toolName, arguments: JSON.stringify(args) },
        }],
      },
    }],
    usage: { prompt_tokens: 10, completion_tokens: 5, total_tokens: 15 },
  };
}

// ==================== Тесты ====================

suite('AgentWorker', () => {
  // MA-1.1: AgentWorker принимает AgentRole и создаёт изолированный контекст
  test('MA-1.1: конструктор сохраняет роль и провайдера', () => {
    const role: AgentRole = {
      name: 'test-worker',
      systemPrompt: 'Ты тестовый агент.',
    };
    const provider = createMockProvider();

    const worker = new AgentWorker(role, provider);

    assert.strictEqual(worker.role.name, 'test-worker');
    assert.strictEqual(worker.role.systemPrompt, 'Ты тестовый агент.');
  });

  // MA-1.2: Воркер использует свой systemPrompt
  test('MA-1.2: systemPrompt роли передаётся в LLM', async () => {
    const role: AgentRole = {
      name: 'coder',
      systemPrompt: 'Ты — эксперт по Python. Пиши чистый код.',
    };
    const provider = createMockProvider([mockTextResponse('Код готов')]);

    const worker = new AgentWorker(role, provider);
    const result = await worker.run('Напиши функцию');

    // Проверяем, что systemPrompt был передан
    const calls = provider.createWithTools.getCalls();
    assert.ok(calls.length > 0, 'createWithTools должен быть вызван');
    const messages = calls[0].args[0];
    const systemMsg = messages.find((m: any) => m.role === 'system');
    assert.ok(systemMsg, 'Должно быть system-сообщение');
    assert.ok(systemMsg.content.includes('Ты — эксперт по Python'), 'systemPrompt должен содержать текст роли');
    assert.ok(systemMsg.content.includes('Доступные инструменты'), 'systemPrompt должен включать список инструментов');
  });

  // MA-1.2: Разные воркеры = разные systemPrompt
  test('MA-1.2: разные роли дают разные systemPrompt', async () => {
    const coderRole: AgentRole = {
      name: 'coder',
      systemPrompt: 'Пиши код',
    };
    const reviewerRole: AgentRole = {
      name: 'reviewer',
      systemPrompt: 'Проверяй код',
    };

    const provider1 = createMockProvider([mockTextResponse('ok')]);
    const provider2 = createMockProvider([mockTextResponse('ok')]);

    const coder = new AgentWorker(coderRole, provider1);
    const reviewer = new AgentWorker(reviewerRole, provider2);

    await coder.run('задача');
    await reviewer.run('задача');

    const coderSystem = provider1.createWithTools.getCalls()[0].args[0]
      .find((m: any) => m.role === 'system').content;
    const reviewerSystem = provider2.createWithTools.getCalls()[0].args[0]
      .find((m: any) => m.role === 'system').content;

    assert.ok(coderSystem.includes('Пиши код'), 'coder должен иметь свой systemPrompt');
    assert.ok(reviewerSystem.includes('Проверяй код'), 'reviewer должен иметь свой systemPrompt');
  });

  // MA-1.3: allowedTools ограничивает доступные инструменты
  test('MA-1.3: allowedTools фильтрует инструменты', async () => {
    const role: AgentRole = {
      name: 'reader',
      systemPrompt: 'Только читай файлы.',
      allowedTools: ['read_file'],
    };
    const provider = createMockProvider([mockTextResponse('прочитано')]);

    const worker = new AgentWorker(role, provider);
    await worker.run('прочитай файл');

    const calls = provider.createWithTools.getCalls();
    const tools = calls[0].args[2];
    const toolNames = tools.map((t: any) => (t as any).function.name);

    assert.strictEqual(toolNames.length, 1, 'Должен быть только 1 инструмент');
    assert.strictEqual(toolNames[0], 'read_file', 'Должен быть только read_file');
  });

  // MA-1.3: Без allowedTools — все инструменты доступны
  test('MA-1.3: без allowedTools — все инструменты доступны', async () => {
    const role: AgentRole = {
      name: 'full-access',
      systemPrompt: 'Делай что хочешь.',
    };
    const provider = createMockProvider([mockTextResponse('ok')]);

    const worker = new AgentWorker(role, provider);
    await worker.run('задача');

    const calls = provider.createWithTools.getCalls();
    const tools = calls[0].args[2];
    const toolNames = tools.map((t: any) => (t as any).function.name);

    assert.ok(toolNames.length >= 5, `Должно быть >=5 инструментов, получено ${toolNames.length}`);
    assert.ok(toolNames.includes('read_file'), 'read_file должен быть доступен');
    assert.ok(toolNames.includes('write_file'), 'write_file должен быть доступен');
  });

  // MA-1.4: Можно указать отдельную модель
  test('MA-1.4: модель из AgentRole.model используется вместо глобальной', async () => {
    const role: AgentRole = {
      name: 'premium-worker',
      systemPrompt: 'Использую Pro модель.',
      model: 'deepseek-v4-pro',
    };
    const provider = createMockProvider([mockTextResponse('ok')]);

    const worker = new AgentWorker(role, provider);
    await worker.run('задача');

    const calls = provider.createWithTools.getCalls();
    const usedModel = calls[0].args[1];
    assert.strictEqual(usedModel, 'deepseek-v4-pro', 'Должна использоваться модель из AgentRole');
  });

  // MA-1.5: run() возвращает {answer, steps, tokens}
  test('MA-1.5: run() возвращает WorkerResult с ответом', async () => {
    const role: AgentRole = {
      name: 'test',
      systemPrompt: 'Отвечай кратко.',
    };
    const provider = createMockProvider([mockTextResponse('Готово!')]);

    const worker = new AgentWorker(role, provider);
    const result = await worker.run('сделай задачу');

    assert.strictEqual(result.answer, 'Готово!', 'answer должен содержать ответ');
    assert.ok(result.steps.length > 0, 'steps не должен быть пустым');
    assert.ok(result.iterations >= 0, 'iterations должен быть >= 0');
    assert.ok(result.inputTokens > 0, 'inputTokens должен быть > 0');
  });

  // MA-1.5: run() с tool call возвращает шаги
  test('MA-1.5: run() с tool call возвращает шаги выполнения', async () => {
    const role: AgentRole = {
      name: 'tool-user',
      systemPrompt: 'Используй инструменты.',
    };
    // Сначала tool call, потом финальный ответ
    const provider = createMockProvider([
      mockToolCallResponse('read_file', { path: 'test.txt' }),
      mockTextResponse('Файл прочитан'),
    ]);

    const worker = new AgentWorker(role, provider);
    const result = await worker.run('прочитай test.txt');

    assert.ok(result.answer.includes('Файл прочитан'), 'Должен быть финальный ответ');
    const toolSteps = result.steps.filter(s => s.type === 'tool_call');
    assert.ok(toolSteps.length > 0, 'Должны быть шаги с tool_call');
    assert.strictEqual(toolSteps[0].toolName, 'read_file', 'Первый tool call должен быть read_file');
  });

  // MA-1.5: run() не зависает, если нет финального ответа
  test('MA-1.5: run() возвращает fallback-ответ при исчерпании итераций', async () => {
    const role: AgentRole = {
      name: 'looper',
      systemPrompt: 'Всегда вызывай инструменты.',
    };
    // Всегда возвращает tool call — никогда не даёт финальный ответ
    const provider = createMockProvider([
      mockToolCallResponse('read_file', { path: 'test.txt' }),
    ]);

    const worker = new AgentWorker(role, provider, { maxIterations: 2 });
    const result = await worker.run('задача');

    assert.ok(result.answer.includes('не дал финального ответа'), 'Должен быть fallback-ответ');
    assert.strictEqual(result.iterations, 2, 'Должно быть 2 tool call (обе итерации)');
  });

  // Дополнительно: изоляция — два воркера не мешают друг другу
  test('Изоляция: два воркера с разными ролями работают независимо', async () => {
    const role1: AgentRole = { name: 'w1', systemPrompt: 'Агент 1' };
    const role2: AgentRole = { name: 'w2', systemPrompt: 'Агент 2' };
    const p1 = createMockProvider([mockTextResponse('ответ 1')]);
    const p2 = createMockProvider([mockTextResponse('ответ 2')]);

    const w1 = new AgentWorker(role1, p1);
    const w2 = new AgentWorker(role2, p2);

    const [r1, r2] = await Promise.all([w1.run('задача 1'), w2.run('задача 2')]);

    assert.strictEqual(r1.answer, 'ответ 1');
    assert.strictEqual(r2.answer, 'ответ 2');
  });

  // F1 SL-4: AgentWorker эмитит события session-log через onEvent (tool/call + tool/result + assistant/message)
  test('F1 SL-4: onEvent получает tool/call, tool/result и assistant/message', async () => {
    const role: AgentRole = { name: 'tool-user', systemPrompt: 'Используй инструменты.' };
    const provider = createMockProvider([
      mockToolCallResponse('read_file', { path: 'test.txt' }),
      mockTextResponse('Файл прочитан'),
    ]);

    const events: any[] = [];
    const worker = new AgentWorker(role, provider, {
      sessionId: 'session_1',
      onEvent: (e) => events.push(e),
    });
    await worker.run('прочитай test.txt');

    const types = events.map(e => e.type);
    assert.ok(types.includes('tool/call'), `ожидался tool/call, получено: ${JSON.stringify(types)}`);
    assert.ok(types.includes('tool/result'), `ожидался tool/result, получено: ${JSON.stringify(types)}`);
    assert.ok(types.includes('assistant/message'), 'ожидался assistant/message');

    const toolCall = events.find(e => e.type === 'tool/call');
    assert.strictEqual(toolCall.name, 'read_file');
    assert.strictEqual(toolCall.sessionId, 'session_1');
    assert.deepStrictEqual(toolCall.args, { path: 'test.txt' });

    const toolResult = events.find(e => e.type === 'tool/result');
    assert.strictEqual(toolResult.name, 'read_file');
    assert.ok(typeof toolResult.result === 'string', 'tool/result.result должен быть строкой');
  });

  // F1 SL-4: без onEvent/sessionId события не эмитятся (гард)
  test('F1 SL-4: без onEvent и sessionId события не эмитятся', async () => {
    const role: AgentRole = { name: 'tool-user', systemPrompt: 'Используй инструменты.' };
    const provider = createMockProvider([
      mockToolCallResponse('read_file', { path: 'test.txt' }),
      mockTextResponse('Файл прочитан'),
    ]);

    // onEvent НЕ передан — события не должны падать
    const worker = new AgentWorker(role, provider);
    const result = await worker.run('прочитай test.txt');
    assert.ok(result.answer.includes('Файл прочитан'), 'должен быть финальный ответ');
  });
});
