// Тесты маппинга tool_name → {label, icon} и описания вызова (P0, Этап 3)
// UMD-модуль (raw JS) — грузится напрямую из src/webviews/chat/toolActivity.js (не компилируется tsc)

import 'mocha';
import * as assert from 'assert';
import * as path from 'path';

interface ToolActivityApi {
  TOOL_LABELS: Record<string, { label: string; icon: string }>;
  toolLabel: (name: string) => { label: string; icon: string };
  toolDetail: (name: string, args?: Record<string, unknown>) => string;
  describeToolCall: (name: string, args?: Record<string, unknown>) => { label: string; icon: string; detail: string };
}

const api = require(path.resolve(__dirname, '../../../src/webviews/chat/toolActivity.js')) as ToolActivityApi;

suite('toolActivity (маппинг tool_name → label/icon)', () => {
  test('известные инструменты маппятся в дружелюбные label+icon (AC P0-3.1)', () => {
    assert.deepStrictEqual(api.toolLabel('read_file'), { label: 'Чтение файла', icon: '📖' });
    assert.deepStrictEqual(api.toolLabel('search_files'), { label: 'Поиск', icon: '🔍' });
    assert.deepStrictEqual(api.toolLabel('run_terminal'), { label: 'Команда', icon: '▶️' });
    assert.deepStrictEqual(api.toolLabel('write_file'), { label: 'Запись файла', icon: '📝' });
    assert.deepStrictEqual(api.toolLabel('list_files'), { label: 'Список файлов', icon: '📂' });
    assert.deepStrictEqual(api.toolLabel('web_fetch'), { label: 'Загрузка страницы', icon: '🌐' });
    assert.deepStrictEqual(api.toolLabel('ask_user'), { label: 'Вопрос', icon: '💬' });
  });

  test('неизвестный инструмент → fallback raw name + 🔧', () => {
    const meta = api.toolLabel('unknown_tool');
    assert.strictEqual(meta.label, 'unknown_tool');
    assert.strictEqual(meta.icon, '🔧');
  });

  test('toolDetail: извлекает релевантный аргумент (AC P0-3.2)', () => {
    assert.strictEqual(api.toolDetail('run_terminal', { command: 'npm install' }), 'npm install');
    assert.strictEqual(api.toolDetail('read_file', { path: '/src/a.ts' }), '/src/a.ts');
    assert.strictEqual(api.toolDetail('write_file', { filePath: '/src/b.ts' }), '/src/b.ts');
    assert.strictEqual(api.toolDetail('search_files', { pattern: 'foo' }), 'foo');
    assert.strictEqual(api.toolDetail('web_fetch', { url: 'https://example.com' }), 'https://example.com');
    assert.strictEqual(api.toolDetail('ask_user', { question: 'Да?' }), 'Да?');
    assert.strictEqual(api.toolDetail('delegate_to_agent', { role: 'reviewer' }), 'reviewer');
  });

  test('toolDetail: пусто для неизвестного/без аргументов', () => {
    assert.strictEqual(api.toolDetail('read_file', undefined), '');
    assert.strictEqual(api.toolDetail('read_file', {}), '');
    assert.strictEqual(api.toolDetail('unknown_tool', { x: 1 }), '');
  });

  test('describeToolCall: объединяет label+icon+detail', () => {
    const desc = api.describeToolCall('run_terminal', { command: 'npm test' });
    assert.deepStrictEqual(desc, { label: 'Команда', icon: '▶️', detail: 'npm test' });
  });
});
