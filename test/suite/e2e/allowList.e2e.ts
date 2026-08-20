// E2E: allow-list — фильтрация инструментов apply-режима и её эффект на ReAct-цикл.

import 'mocha';
import * as assert from 'assert';
import { ToolSystem } from '../../../src/modes/apply/ToolSystem';
import { createTools } from '../../../src/modes/apply/ToolDefinitions';
import { getAllowedTools } from '../../../src/modes/apply/ToolAllowList';
import { AgentController } from '../../../src/modes/apply/AgentController';

suite('E2E: allow-list', () => {
  test('getAllowedTools фильтрует до разрешённых', () => {
    const allowed = getAllowedTools(createTools(), { allowedTools: ['read_file', 'search_files'] });
    const names = allowed.map((t) => t.name).sort();
    assert.deepStrictEqual(names, ['read_file', 'search_files']);
  });

  test('пустой allowedTools → все инструменты (обратная совместимость)', () => {
    const allowed = getAllowedTools(createTools(), {});
    assert.strictEqual(allowed.length, createTools().length);
  });

  test('отфильтрованный write_file недоступен в ToolSystem', () => {
    const ts = new ToolSystem();
    ts.registerAll(getAllowedTools(createTools(), { allowedTools: ['read_file'] }));

    assert.ok(ts.getTool('read_file'), 'read_file доступен');
    assert.strictEqual(ts.getTool('write_file'), undefined, 'write_file отфильтрован');
  });

  test('агент вызывает отфильтрованный write_file → трактуется как финальный ответ (не выполняется)', async () => {
    const ts = new ToolSystem();
    ts.registerAll(getAllowedTools(createTools(), { allowedTools: ['read_file'] }));
    const agent = new AgentController(ts);

    const provider: any = {
      chat: async function* () {
        yield JSON.stringify({ tool: 'write_file', arguments: { path: 'x.txt', content: 'y' } });
      },
    };

    const result = await agent.run({ provider, model: 'test-model', task: 'запиши файл', maxIterations: 3 });

    // write_file отсутствует в реестре → parseToolCall вернул null → это финальный ответ, tool не вызывался
    assert.strictEqual(result.iterations, 1);
    assert.ok(!result.steps.some((s) => s.type === 'tool_call'), 'tool_call не было');
  });
});
