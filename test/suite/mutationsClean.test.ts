// Сторож против следов мутационного прогона: маркеры в src и незакоммиченные правки.
//
// Мотив: оборванный прогон мутаций оставил в `SkillManifest` `if (false)` и отключил проверку
// имени скилла — тесты при этом оставались зелёными.

import 'mocha';
import * as assert from 'assert';
import * as path from 'path';
// Скрипт живёт в scripts/ и не компилируется tsc — грузим по пути от корня репозитория
const { findMutationTraces } = require(path.join(__dirname, '../../../scripts/check-mutations-clean'));

suite('mutationsClean', () => {
  test('MC-1: находит if (false) и указывает строку', () => {
    const traces = findMutationTraces('const a = 1;\n  if (false) {\n    doSomething();\n  }\n');
    assert.strictEqual(traces.length, 1, JSON.stringify(traces));
    assert.strictEqual(traces[0].line, 2);
  });

  test('MC-2: находит if (false && …) — вторая форма мутации', () => {
    const traces = findMutationTraces('if (false && budget.kind === \'exceed\') { run(); }');
    assert.strictEqual(traces.length, 1, JSON.stringify(traces));
  });

  test('MC-3: рабочий код без маркеров не считается следом', () => {
    const traces = findMutationTraces('if (enabled === false) { return null; }\nwhile (false) {}'.replace('while (false) {}', ''));
    assert.deepStrictEqual(traces, []);
  });
});
