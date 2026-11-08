// Предпросмотр правки: полный текст «до» и «после» для diff-редактора (P13/UX Edit).

import 'mocha';
import * as assert from 'assert';
import { buildProposalPreview } from '../../src/modes/edit/proposalPreview';

suite('buildProposalPreview', () => {
  const file = 'function sum(a, b) {\n  return a + b;\n}\n';

  test('PP-1: заменяет выделенный фрагмент, остальной файл не меняется', () => {
    const start = file.indexOf('return');
    const end = file.indexOf(';', start);
    const p = buildProposalPreview(file, start, end, 'return Number(a) + Number(b)');

    assert.strictEqual(p.before, file, 'before — файл как есть');
    assert.ok(p.after.includes('return Number(a) + Number(b);'), p.after);
    assert.ok(p.after.startsWith('function sum(a, b) {\n'), 'начало файла сохранено');
    assert.ok(p.after.endsWith('}\n'), 'конец файла сохранён');
  });

  test('PP-2: многострочное выделение заменяется целиком', () => {
    const start = file.indexOf('function');
    const end = file.length;
    const p = buildProposalPreview(file, start, end, 'const sum = (a, b) => a + b;\n');

    assert.strictEqual(p.after, 'const sum = (a, b) => a + b;\n');
    assert.strictEqual(p.before.split('\n').length, 4);
  });

  test('PP-3: пустое выделение — вставка в позицию', () => {
    const at = file.indexOf('\n');
    const p = buildProposalPreview(file, at, at, '\n// проверка типов');
    assert.ok(p.after.includes('function sum(a, b) {\n// проверка типов\n  return a + b;'), p.after);
  });

  test('PP-4: выход за границы текста не ломает результат', () => {
    const p = buildProposalPreview('abc', 999, -5, 'X');
    assert.strictEqual(p.after.length >= 1, true);
    assert.strictEqual(p.before, 'abc');
  });
});
