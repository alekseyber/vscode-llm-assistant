// Тесты сводки по изменениям файлов (src/shared/runSummary.ts).
// Смысл: строка «Изменено файлов: N» показывает, что модель сказала «готово» без правок.

import 'mocha';
import * as assert from 'assert';
import { changedFiles, countFileChanges, fileChangesSummary, WRITE_TOOLS } from '../../src/shared/runSummary';

suite('runSummary / изменения файлов', () => {
  test('SUM-1: успешная запись и патч считаются, чтение — нет', () => {
    const steps = [
      { type: 'tool_call', toolName: 'read_file' },
      { type: 'tool_result', toolName: 'read_file', toolResult: 'Файл: a.txt' },
      { type: 'tool_result', toolName: 'write_file', toolResult: 'Файл записан: /w/a.txt (8 символов)' },
      { type: 'tool_result', toolName: 'patch_file', toolResult: 'Патч применён' },
    ];
    assert.strictEqual(countFileChanges(steps), 2);
    assert.strictEqual(fileChangesSummary(steps), '📝 Изменено файлов: 2');
  });

  test('SUM-5: повторная запись того же файла — одна правка, а не две', () => {
    const steps = [
      { type: 'tool_result', toolName: 'write_file', toolResult: 'Файл записан: /w/a.txt (8 символов)' },
      { type: 'tool_result', toolName: 'write_file', toolResult: 'Файл записан: /w/a.txt (8 символов)' },
    ];
    assert.deepStrictEqual(changedFiles(steps), ['/w/a.txt']);
    assert.strictEqual(fileChangesSummary(steps), '📝 Изменено файлов: 1');
  });

  test('SUM-6: «Файл не изменён» не считается правкой', () => {
    const steps = [
      { type: 'tool_result', toolName: 'write_file', toolResult: 'Файл не изменён: содержимое уже совпадает (/w/a.txt)' },
    ];
    assert.strictEqual(fileChangesSummary(steps), '📝 Файлы не изменялись');
  });

  test('SUM-2: прогон без правок даёт «Файлы не изменялись» (случай «Готово» без инструментов)', () => {
    assert.strictEqual(fileChangesSummary([]), '📝 Файлы не изменялись');
    assert.strictEqual(fileChangesSummary([{ type: 'tool_result', toolName: 'read_file', toolResult: 'ok' }]), '📝 Файлы не изменялись');
    assert.strictEqual(fileChangesSummary(undefined), '📝 Файлы не изменялись');
  });

  test('SUM-3: отказ и ошибка записи не считаются изменением', () => {
    const steps = [
      { type: 'tool_result', toolName: 'write_file', toolResult: 'Операция отклонена пользователем.' },
      { type: 'tool_result', toolName: 'patch_file', toolResult: 'Ошибка: файл не найден' },
    ];
    assert.strictEqual(countFileChanges(steps), 0);
  });

  test('SUM-4: набор инструментов записи включает write_file, patch_file, replace_in_file', () => {
    assert.deepStrictEqual([...WRITE_TOOLS].sort(), ['patch_file', 'replace_in_file', 'write_file']);
  });
});
