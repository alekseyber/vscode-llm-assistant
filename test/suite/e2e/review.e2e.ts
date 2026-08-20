// E2E: CodeReviewer — standalone AI-ревью (мок createWithTools, без реальных LLM-вызовов)

import 'mocha';
import * as assert from 'assert';
import { CodeReviewer } from '../../../src/modes/review/CodeReviewer';

suite('E2E: CodeReviewer', () => {
  test('reviewFile возвращает отчёт (мок createWithTools)', async () => {
    const mockProvider = {
      createWithTools: async () => ({
        choices: [{ message: { content: '# Отчёт\n🔴 критично: SQL-инъекция' } }],
        usage: { prompt_tokens: 100, completion_tokens: 50 },
      }),
    };

    const result = await new CodeReviewer().reviewFile('/tmp/review-target.ts', mockProvider, 'test-model');

    assert.ok(result.report.includes('SQL-инъекция'), 'отчёт содержит замечание');
    assert.ok(result.iterations >= 1, 'была хотя бы одна итерация');
  });

  test('reviewCode: пустой код → ранняя ошибка без вызова LLM (CR-4)', async () => {
    let called = false;
    const mockProvider = {
      createWithTools: async () => { called = true; return { choices: [], usage: {} }; },
    };

    const result = await new CodeReviewer().reviewCode('   ', 'ts', '/tmp/a.ts', mockProvider, 'test-model');

    assert.strictEqual(result.report, 'Ошибка: нет кода для ревью');
    assert.strictEqual(called, false, 'createWithTools не вызван');
  });
});
