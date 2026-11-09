// E2E-6: workspace-контекст агента — правила роли, каталог скилов, allow-list инструментов.
// Проверяется тело реального запроса к стабу, а не промежуточные функции.
// AC: E2E-6

import 'mocha';
import * as assert from 'assert';
import * as fs from 'fs';
import * as path from 'path';
import * as vscode from 'vscode';
import { AgentWorker, AgentRole } from '../../../src/modes/apply/AgentWorker';
import { OpenAIProvider } from '../../../src/providers/openai';
import { invalidateRoleCache } from '../../../src/shared/RoleAgentsMdLoader';
import { applySettings, SettingsSnapshot } from './helpers/settings';
import { startStub, json } from './helpers/net';

const REPO_ROOT = path.resolve(__dirname, '../../../..');
const FIXTURE = path.join(REPO_ROOT, 'test', 'fixtures', 'e2e-workspace');

/** Корень копии фикстуры, на которой запущен Extension Host. */
function wsRoot(): string {
  const folder = vscode.workspace.workspaceFolders?.[0];
  assert.ok(folder, 'Extension Host должен быть запущен на копии фикстуры');
  return folder.uri.fsPath;
}

interface Captured {
  bodies: any[];
  close: () => Promise<void>;
  url: string;
}

/** Стаб OpenAI-совместимого чата: копит тела запросов, отвечает обычным текстом. */
async function captureStub(): Promise<Captured> {
  const bodies: any[] = [];
  const stub = await startStub((_req, res, body) => {
    bodies.push(body);
    json(res, {
      choices: [{ message: { role: 'assistant', content: 'готово' }, finish_reason: 'stop' }],
      usage: { prompt_tokens: 10, completion_tokens: 2 },
    });
  });
  return { bodies, close: stub.close, url: stub.url };
}

const ROLE: AgentRole = { name: 'coder', systemPrompt: 'Ты кодер (фикстура).' };

async function runOnce(url: string, task = 'задача'): Promise<any> {
  const provider = new OpenAIProvider({ name: 'local', baseUrl: `${url}/v1`, apiKey: 'x', models: ['qwen3-8b'] });
  const worker = new AgentWorker(ROLE, provider, { maxIterations: 1, model: 'qwen3-8b' });
  await worker.run(task);
}

function systemPromptOf(capture: Captured, index = -1): string {
  const body = index < 0 ? capture.bodies[capture.bodies.length - 1] : capture.bodies[index];
  assert.ok(body, 'стаб получил хотя бы один запрос');
  return String(body.messages?.[0]?.content ?? '');
}

suite('E2E-6: workspace-контекст агента', () => {
  let snap: SettingsSnapshot | undefined;
  let capture: Captured | undefined;

  setup(async () => {
    snap = await applySettings({ 'local.toolLoop': true, 'local.numCtx': 8192, 'retry.enabled': false });
    capture = await captureStub();
    invalidateRoleCache();
  });

  teardown(async () => {
    await capture?.close();
    capture = undefined;
    await snap?.restore();
    snap = undefined;
    // вернуть удалённые файлы фикстуры
    for (const rel of ['.llma/agents/coder.md', '.llma/skills/coder.md']) {
      const src = path.join(FIXTURE, rel);
      const dst = path.join(wsRoot(), rel);
      if (fs.existsSync(src)) {
        fs.mkdirSync(path.dirname(dst), { recursive: true });
        fs.copyFileSync(src, dst);
      }
    }
    invalidateRoleCache();
  });

  test('E2E-6a: правила роли из .llma/agents/coder.md попадают в системный промпт', async function () {
    this.timeout(20000);
    await runOnce(capture!.url);
    const prompt = systemPromptOf(capture!);
    assert.match(prompt, /E2E-ROLE-MARKER-CODER/, 'в промпте есть правила роли');
    assert.match(prompt, /Правила роли/, 'секция правил названа');
  });

  test('E2E-6b: каталог скилов с description из frontmatter; удалили каталог — секция исчезла', async function () {
    this.timeout(30000);
    await runOnce(capture!.url);
    const withSkills = systemPromptOf(capture!);
    assert.match(withSkills, /Доступные скилы/, 'каталог скилов в промпте');
    assert.match(withSkills, /Пишет код по описанию задачи \(фикстура e2e\)/, 'description из frontmatter');

    // Удаляем каталог в копии фикстуры
    const skillsDir = path.join(wsRoot(), '.llma', 'skills');
    fs.rmSync(skillsDir, { recursive: true, force: true });
    invalidateRoleCache();

    await runOnce(capture!.url);
    const withoutSkills = systemPromptOf(capture!);
    assert.ok(!withoutSkills.includes('Доступные скилы'), 'без каталога секции нет');
    assert.ok(!withoutSkills.includes('(фикстура e2e)'), 'и описаний скилов тоже нет');
  });

  test('E2E-6c: allow-list из .vscode/llm-assistant.json режет tools[] — run_terminal не уходит модели', async function () {
    this.timeout(20000);
    await runOnce(capture!.url);
    const body = capture!.bodies[capture!.bodies.length - 1];
    const names = (body.tools ?? []).map((t: any) => t.function?.name);
    assert.ok(names.includes('read_file'), `read_file разрешён (получено: ${names.join(', ')})`);
    assert.ok(!names.includes('run_terminal'), `run_terminal запрещён (получено: ${names.join(', ')})`);
    assert.ok(!names.includes('web_fetch'), 'инструменты вне allow-list не отправляются');
  });

  test('E2E-6d: удалили .llma/agents/coder.md — правил роли нет, fallback main.md работает', async function () {
    this.timeout(20000);
    fs.rmSync(path.join(wsRoot(), '.llma', 'agents', 'coder.md'), { force: true });
    fs.writeFileSync(path.join(wsRoot(), '.llma', 'main.md'), '# main\n\nE2E-MAIN-MARKER: общие правила.\n');
    invalidateRoleCache();

    await runOnce(capture!.url);
    const prompt = systemPromptOf(capture!);
    assert.ok(!prompt.includes('E2E-ROLE-MARKER-CODER'), 'правил роли больше нет');
    assert.match(prompt, /E2E-MAIN-MARKER/, 'взят fallback .llma/main.md');
    fs.rmSync(path.join(wsRoot(), '.llma', 'main.md'), { force: true });
  });
});
