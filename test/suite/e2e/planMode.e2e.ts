// E2E-13: Plan Mode — план на диск и имплементация, на настоящем HTTP-стабе.
// Проводку «панель → сессия → имплементация в исходную сессию» держит E2E «Plan Mode —
// сессионная привязка»; здесь проверяется то, чего там нет: планировщик реально пишет
// файл через write_file (стаб отдаёт tool_call), а имплементация проходит цикл воркеров
// и читает план с диска.

import 'mocha';
import * as assert from 'assert';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import * as vscode from 'vscode';
import { PlanModeManager } from '../../../src/modes/chat/PlanModeManager';
import { OllamaProvider } from '../../../src/providers/ollama';
import { startStub, ndjson } from './helpers/net';

const PLAN_MARKER = 'E2E-PLAN-MARKER';

function workspaceRoot(): string {
  const folder = (vscode.workspace.workspaceFolders ?? [])[0];
  assert.ok(folder, 'рабочее пространство открыто');
  return folder!.uri.fsPath;
}

suite('E2E-13: Plan Mode — план на диске и имплементация', () => {
  let stub: Awaited<ReturnType<typeof startStub>>;
  let root: string;
  let plansDir: string;
  let plannerCalls = 0;

  setup(async () => {
    root = workspaceRoot();
    plansDir = path.join(root, '.llma', 'plans');
    plannerCalls = 0;

    // Стаб нативного /api/chat: планировщику — tool_call write_file, дальше — короткие ответы.
    // Берём non-loopback адрес, чтобы адрес не влиял на «локальность» провайдера.
    const list = Object.values(os.networkInterfaces())
      .flat()
      .filter((e: any) => e && e.family === 'IPv4' && !e.internal);
    const host = (list[0] as any)?.address ?? '127.0.0.1';

    stub = await startStub(
      (_req, res, body) => {
        const system = String(body?.messages?.[0]?.content ?? '');
        const reply = (text: string) =>
          ndjson(res, [
            { message: { role: 'assistant', content: text }, done: false },
            { message: { role: 'assistant', content: '' }, done: true, prompt_eval_count: 40, eval_count: 10 },
          ]);

        if (system.includes('планировщик')) {
          plannerCalls += 1;
          const planPath = /plan_\d{4}-\d{2}-\d{2}_[0-9a-f]{8}\.md/.exec(JSON.stringify(body))?.[0];
          if (planPath && plannerCalls === 1) {
            // Формат, который разбирает AgentController: {"tool": "...", "arguments": {...}}
            reply(
              JSON.stringify({
                tool: 'write_file',
                arguments: {
                  path: planPath,
                  content: `# План\n\n${PLAN_MARKER}\n\n## AC-1\nСделать проверку\n`,
                },
              }),
            );
            return;
          }
          reply('План записан.');
          return;
        }
        reply('Изменения внесены.');
      },
      0,
      host,
    );
  });

  teardown(() => {
    try {
      if (fs.existsSync(plansDir)) fs.rmSync(plansDir, { recursive: true, force: true });
    } catch {
      /* мимо */
    }
  });

  test('E2E-13a: планировщик пишет план файлом через write_file', async function () {
    this.timeout(60000);
    const provider = new OllamaProvider({ name: 'local', baseUrl: stub.url, models: ['qwen3:8b'] });
    const manager = new PlanModeManager(root, 'e2e-plan', () => undefined);

    const plan = await manager.generatePlan('спланируй проверку', provider, 'qwen3:8b');

    assert.ok(fs.existsSync(plan.planPath), `файл плана создан на диске: ${plan.planPath}`);
    const onDisk = fs.readFileSync(plan.planPath, 'utf-8');
    assert.ok(onDisk.includes(PLAN_MARKER), 'содержимое записано инструментом, а не подставлено менеджером');
    assert.ok(plan.content.includes(PLAN_MARKER), 'менеджер читает план с диска');
    assert.ok(path.basename(plan.planPath).startsWith('plan_'), 'имя файла по шаблону plan_<дата>_<id>.md');
  });

  test('E2E-13b: имплементация проходит цикл воркеров и оставляет план на месте', async function () {
    this.timeout(90000);
    const files = fs.existsSync(plansDir) ? fs.readdirSync(plansDir).filter((f) => f.endsWith('.md')) : [];
    if (files.length === 0) {
      // Зависит от предыдущего теста: честнее пропустить, чем пройти вхолостую
      this.skip();
      return;
    }

    const provider = new OllamaProvider({ name: 'local', baseUrl: stub.url, models: ['qwen3:8b'] });
    const manager = new PlanModeManager(root, 'e2e-plan', () => undefined);
    const planPath = path.join(plansDir, files[0]);
    const logs: string[] = [];

    const result = await manager.implementPlan(planPath, provider, 'qwen3:8b', (msg) => logs.push(msg));

    assert.ok(result.orchestratorResult, 'оркестратор вернул результат');
    assert.ok(Array.isArray(result.orchestratorResult.workers), 'список воркеров есть');
    assert.ok(logs.length > 0, `имплементация писала лог: ${logs.slice(0, 3).join(' | ')}`);
    // План не должен исчезнуть или обнулиться в процессе имплементации
    assert.ok(fs.existsSync(planPath), 'файл плана на месте после имплементации');
    assert.ok(fs.readFileSync(planPath, 'utf-8').includes(PLAN_MARKER), 'содержимое плана сохранилось');
  });
});
