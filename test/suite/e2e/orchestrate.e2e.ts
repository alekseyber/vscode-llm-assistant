// E2E-15: `@orchestrate` целиком — роли из рабочего пространства, вкладка оркестратора, итог в чате.
//
// Почему e2e: юниты проверяют отдельные шаги (`AgentOrchestrator.execute`, `OrchestratorViewProvider`),
// но не связку «сообщение в панели чата → цепочка ролей → статусы в дереве → итог в чате».
// Провал роли и отмену здесь сознательно не проверяем — это зона юнитов, иначе тест раздувается.
//
// Границы: проверяется механика передачи задачи между ролями и отображение статусов,
// а не качество ответов ролей (его оценивает человек и evals из P12).

import 'mocha';
import * as assert from 'assert';
import * as fs from 'fs';
import * as path from 'path';
import * as vscode from 'vscode';
import { ChatViewProvider } from '../../../src/modes/chat/ChatViewProvider';
import { ConversationManager } from '../../../src/modes/chat/ConversationManager';
import { OrchestratorViewProvider } from '../../../src/modes/orchestrator/OrchestratorViewProvider';
import { ProviderManager } from '../../../src/providers/manager';
import { RunHistoryStore } from '../../../src/shared/RunHistoryStore';
import { SessionLog } from '../../../src/shared/SessionLog';
import { applySettings, SettingsSnapshot } from './helpers/settings';
import { startStub, json } from './helpers/net';
import { createFakeWebviewView, messagesOfType } from './helpers/webview';
import { waitFor } from './helpers/wait';

const REPO_ROOT = path.resolve(__dirname, '../../../..');

function memoryMemento(): any {
  const store = new Map<string, unknown>();
  return {
    get: (key: string, fallback?: unknown) => (store.has(key) ? store.get(key) : fallback),
    update: async (key: string, value: unknown) => {
      store.set(key, value);
    },
    keys: () => [...store.keys()],
  };
}

/** Роли берутся из `.llma/agents/NN-*.md` рабочего пространства — порядок задаёт имя файла. */
function writeRoles(root: string): void {
  const dir = path.join(root, '.llma', 'agents');
  fs.mkdirSync(dir, { recursive: true });
  const roles: Array<[string, string]> = [
    ['01-architect.md', 'E2E-ARCHITECT-MARKER: спроектируй решение'],
    ['02-coder.md', 'E2E-CODER-MARKER: напиши код'],
    ['03-reviewer.md', 'E2E-REVIEWER-MARKER: проверь код'],
  ];
  for (const [name, body] of roles) {
    fs.writeFileSync(path.join(dir, name), `# ${name}\n${body}\n`, 'utf-8');
  }
}

/**
 * Снимок каталога ролей: в фикстуре уже лежат `architect/coder/reviewer.md` для `E2E-6`,
 * и первая версия этого теста сносила каталог в teardown — падал чужой тест.
 */
function snapshotRoles(root: string): Map<string, string> {
  const dir = path.join(root, '.llma', 'agents');
  const snapshot = new Map<string, string>();
  if (!fs.existsSync(dir)) return snapshot;
  for (const name of fs.readdirSync(dir)) {
    snapshot.set(name, fs.readFileSync(path.join(dir, name), 'utf-8'));
  }
  return snapshot;
}

function restoreRoles(root: string, snapshot: Map<string, string>): void {
  const dir = path.join(root, '.llma', 'agents');
  fs.rmSync(dir, { recursive: true, force: true });
  if (snapshot.size === 0) return;
  fs.mkdirSync(dir, { recursive: true });
  for (const [name, body] of snapshot) fs.writeFileSync(path.join(dir, name), body, 'utf-8');
}

suite('E2E-15: @orchestrate', function () {
  this.timeout(120_000);

  let snap: SettingsSnapshot | undefined;
  let stub: { url: string; bodies: any[]; close: () => Promise<void> } | undefined;
  let chatView: ReturnType<typeof createFakeWebviewView>;
  let orchView: ReturnType<typeof createFakeWebviewView>;
  let history: RunHistoryStore;
  let workspace: string;
  let restoreRolesAfter: (() => void) | undefined;

  setup(async () => {
    const folder = (vscode.workspace.workspaceFolders ?? [])[0];
    assert.ok(folder, 'рабочее пространство открыто');
    workspace = folder!.uri.fsPath;
    // Каталог ролей один на рабочее пространство: снимаем чужое содержимое и возвращаем после
    const previous = snapshotRoles(workspace);
    writeRoles(workspace);
    restoreRolesAfter = () => restoreRoles(workspace, previous);

    let request = 0;
    // Нативный формат Ollama: createWithTools ходит не стримингом, ответ — один JSON-объект.
    // Без tool_calls цикл закрывается сразу после первого шага.
    stub = await startStub((_req, res) => {
      request += 1;
      json(res, {
        message: { role: 'assistant', content: `этап ${request}: сделано` },
        done: true,
        prompt_eval_count: 100,
        eval_count: 20,
      });
    });

    snap = await applySettings({
      providers: { local: { type: 'ollama', baseUrl: `http://${new URL(stub!.url).host}`, title: 'Stub', models: ['qwen3:8b'] } },
      defaultProvider: 'local',
      defaultModel: 'qwen3:8b',
      'agent.maxIterations': 3,
      // Без этого флага агентский цикл локальной модели выключен и воркеры не работают
      'local.toolLoop': true,
      'chat.summaryEnabled': false,
      'chat.includeOpenFile': false,
      'retry.enabled': false,
    });

    const ctx: any = {
      subscriptions: [],
      extensionUri: vscode.Uri.file(REPO_ROOT),
      globalState: memoryMemento(),
      workspaceState: memoryMemento(),
    };
    const sessionLog = new SessionLog(ctx.workspaceState);
    const conversation = new ConversationManager(ctx.workspaceState, sessionLog);
    history = new RunHistoryStore(ctx.globalState);

    orchView = createFakeWebviewView();
    const orchestrator = new OrchestratorViewProvider();
    orchestrator.resolveWebviewView(orchView as any, {} as any, { isCancellationRequested: false } as any);

    chatView = createFakeWebviewView();
    const provider = new ChatViewProvider(
      ctx,
      new ProviderManager(),
      conversation,
      history,
      undefined,
      orchestrator,
      sessionLog,
    );
    provider.resolveWebviewView(chatView as any, {} as any, { isCancellationRequested: false } as any);
  });

  teardown(async () => {
    await snap?.restore();
    await stub?.close();
    restoreRolesAfter?.();
  });

  test('E2E-15: роли идут по цепочке, статусы меняются, итог приходит в чат', async () => {
    chatView.send({ type: 'sendMessage', text: '@orchestrate сделай фичу целиком', mode: 'agent' });

    // 1. Вкладка получила задачу с тремя воркерами в статусе pending
    await waitFor(() => messagesOfType(orchView, 'taskUpdate').length > 0, 10_000, 50, 'taskUpdate');
    assert.strictEqual(messagesOfType(orchView, 'taskUpdate').length, 1, 'задача показана один раз');
    const task = messagesOfType(orchView, 'taskUpdate')[0].task;
    assert.strictEqual(task.goal, 'сделай фичу целиком', 'цель задачи из сообщения');
    assert.strictEqual(task.strategy, 'sequential', 'стратегия последовательная');
    assert.deepStrictEqual(
      task.workers.map((w: any) => w.roleName),
      ['01-architect', '02-coder', '03-reviewer'],
      'роли взяты из .llma/agents в порядке имён файлов',
    );
    assert.ok(task.workers.every((w: any) => w.status === 'pending'), 'стартовые статусы pending');

    // 2. Каждая роль проходит через running → done, в том же порядке
    await waitFor(
      () => messagesOfType(orchView, 'workerUpdate').filter((m) => m.updates?.status === 'done').length >= 3,
      60_000,
      100,
      'три завершённых воркера',
    );
    const updates = messagesOfType(orchView, 'workerUpdate');
    const started = updates.filter((m) => m.updates?.status === 'running').map((m) => m.roleName);
    // Статус «готово» приходит дважды на роль: сначала от воркера, затем с деталями
    // (шаги, ответ, токены) — так обновляет сама панель после цепочки. Порядок проверяем
    // по первому появлению роли, наличие деталей — отдельно.
    const finishedAll = updates.filter((m) => m.updates?.status === 'done').map((m) => m.roleName);
    const finishedUnique = Array.from(new Set(finishedAll));
    // Порядок старта строго не проверяем: воркер может успеть завершиться до чтения журнала.
    // Важно, что каждая роль получила running и что порядок завершения последовательный.
    assert.deepStrictEqual([...started].sort(), ['01-architect', '02-coder', '03-reviewer'], `стартовали все роли: ${started}`);
    assert.deepStrictEqual(finishedUnique, ['01-architect', '02-coder', '03-reviewer'], `порядок завершения: ${finishedAll}`);

    // Детали приходят вторым обновлением: шаги, ответ и токены, а не только статус
    for (const role of ['01-architect', '02-coder', '03-reviewer']) {
      const detailed = updates.filter((m) => m.roleName === role && m.updates?.status === 'done').at(-1);
      assert.ok(detailed, `есть обновление роли ${role}`);
      assert.ok(Number(detailed.updates.steps) >= 1, `у ${role} посчитаны шаги: ${JSON.stringify(detailed.updates)}`);
      assert.ok(String(detailed.updates.answer ?? '').length > 0, `у ${role} есть ответ в деталях`);
      assert.ok(Number(detailed.updates.inputTokens) > 0, `у ${role} есть токены: ${JSON.stringify(detailed.updates)}`);
    }

    // 3. Итог дошёл до чата
    const text = messagesOfType(chatView, 'streamChunk').map((m) => m.text).join('');
    assert.ok(text.includes('Оркестратор'), `чат получил сообщение оркестратора: ${text.slice(0, 300)}`);

    // 4. Запись в истории — режим agent, не чат
    const runs = history.getRuns().filter((r) => r.task.includes('сделай фичу целиком'));
    assert.strictEqual(runs.length, 1, `одна запись прогона: ${JSON.stringify(history.getRuns().map((r) => r.task))}`);
    assert.strictEqual(runs[0].mode, 'agent', 'прогон записан как агентский');

    // 5. Цепочка не молчит и не зацикливается: минимум по запросу на роль, но не больше
    // потолка итераций на воркера (иначе цикл ушёл бы в бесконечность)
    const requests = stub!.bodies.filter((b) => Array.isArray(b?.messages)).length;
    assert.ok(requests >= 3, `запросов не меньше, чем ролей: ${requests}`);
    assert.ok(requests <= 3 * 3, `запросов не больше потолка итераций: ${requests}`);

    // 6. Контекст предыдущей роли доехал до следующей: в промпте второго воркера есть ответ первого
    const secondPrompt = String(stub!.bodies.filter((b) => Array.isArray(b?.messages))[1]?.messages?.map((m: any) => m.content).join('\n') ?? '');
    assert.ok(
      secondPrompt.includes('этап 1'),
      `второй воркер получает результат первого: ${secondPrompt.slice(0, 400)}`,
    );
  });
});
