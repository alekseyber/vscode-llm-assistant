// E2E-10: ReAct-цикл с инструментами, которых не касались прежние e2e.
// Через живой HTTP-стаб (нативный /api/chat) и настоящий OllamaProvider:
// search_files → patch_file → финальный ответ. Проверяется не только результат,
// но и то, что observation реально ушёл в следующий запрос, и файл на диске изменён.

import 'mocha';
import * as assert from 'assert';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { ToolSystem } from '../../../src/modes/apply/ToolSystem';
import { createTools } from '../../../src/modes/apply/ToolDefinitions';
import { AgentController } from '../../../src/modes/apply/AgentController';
import { OllamaProvider } from '../../../src/providers/ollama';
import { startStub, ndjson } from './helpers/net';
import { applySettings, SettingsSnapshot } from './helpers/settings';

suite('E2E-10: ReAct с patch_file и search_files (живой HTTP)', () => {
  let tmpDir: string;
  let snap: SettingsSnapshot | undefined;

  setup(async () => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'llma-tools-'));
    snap = await applySettings({ 'chat.summaryEnabled': false, 'retry.enabled': false });
  });

  teardown(async () => {
    await snap?.restore();
    snap = undefined;
    try {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    } catch {
      /* файлы могли не создаться — это не повод валить teardown */
    }
  });

  test('агент: search_files → patch_file → финальный ответ, файл изменён на диске', async function () {
    this.timeout(30000);
    const target = path.join(tmpDir, 'config.txt');
    fs.writeFileSync(target, 'старое содержимое', 'utf-8');

    // Первый запрос может уйти на discovery/ps — отвечаем по счётчику именно на /api/chat
    const script = [
      JSON.stringify({ tool: 'search_files', arguments: { pattern: 'содержимое', path: tmpDir } }),
      JSON.stringify({ tool: 'patch_file', arguments: { path: target, old: 'старое', new: 'новое' } }),
      'Готово: файл обновлён.',
    ];
    let chat = 0;
    const stub = await startStub((req, res) => {
      const url = (req.url ?? '').split('?')[0];
      if (url === '/api/ps') {
        ndjson(res, [{ models: [] }]);
        return;
      }
      if (url === '/api/tags') {
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ models: [{ name: 'qwen3:8b', model: 'qwen3:8b' }] }));
        return;
      }
      const chunk = script[Math.min(chat, script.length - 1)];
      chat += 1;
      ndjson(res, [
        { message: { role: 'assistant', content: chunk }, done: false },
        { message: { role: 'assistant', content: '' }, done: true, prompt_eval_count: 40, eval_count: 10 },
      ]);
    });

    try {
      const provider = new OllamaProvider({ name: 'local', baseUrl: stub.url, models: ['qwen3:8b'] });
      const toolSystem = new ToolSystem();
      toolSystem.registerAll(createTools());
      const agent = new AgentController(toolSystem);

      const result = await agent.run({
        provider,
        model: 'qwen3:8b',
        task: 'найди файл и замени «старое» на «новое»',
        maxIterations: 6,
      });

      // 1) Файловый эффект проверяем на диске, а не по возвращённому значению инструмента
      assert.strictEqual(fs.readFileSync(target, 'utf-8'), 'новое содержимое', 'patch_file применился к реальному файлу');

      // 2) Оба инструмента прошли полный путь: вызов + результат
      const called = result.steps.filter((s) => s.type === 'tool_call').map((s) => s.tool);
      assert.deepStrictEqual(called, ['search_files', 'patch_file'], 'инструменты вызваны в ожидаемом порядке');
      assert.strictEqual(result.answer, 'Готово: файл обновлён.');
      assert.strictEqual(result.iterations, 3, 'два инструментальных шага и финальный ответ');

      // 3) Observation действительно попал в следующий запрос — иначе цикл «реагирует» вхолостую
      const secondBody = JSON.stringify(stub.bodies[1] ?? {});
      assert.ok(secondBody.includes('содержимое'), 'во второй запрос ушёл результат search_files');
      assert.ok(secondBody.includes('Файл обновлён') || secondBody.includes('новое содержимое'), 'результат patch_file вернулся агенту');
    } finally {
      await stub.close();
    }
  });
});
