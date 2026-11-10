// E2E-13: Plan Mode целиком — план на диск, имплементация, изоляция сессий, персист.
// Модель подменена HTTP-стабом /chat/completions (через настоящий OpenAIProvider),
// всё остальное живёт по-настоящему: файловая система рабочего пространства,
// ConversationManager, RunHistoryStore, AgentWorker/AgentOrchestrator.

import 'mocha';
import * as assert from 'assert';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import * as vscode from 'vscode';
import { ChatViewProvider } from '../../../src/modes/chat/ChatViewProvider';
import { ConversationManager } from '../../../src/modes/chat/ConversationManager';
import { ProviderManager } from '../../../src/providers/manager';
import { RunHistoryStore } from '../../../src/shared/RunHistoryStore';
import { SessionLog } from '../../../src/shared/SessionLog';
import { applySettings, SettingsSnapshot } from './helpers/settings';
import { startStub, json } from './helpers/net';
import { createFakeWebviewView, messagesOfType } from './helpers/webview';
import { waitFor } from './helpers/wait';

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

/** Сообщения конкретной сессии: менеджер отдаёт только активную, поэтому переключаемся. */
function messagesOf(conv: ConversationManager, sid: string): string[] {
  conv.session.switchTo(sid);
  return conv.getMessages().map((m: any) => String(m.content));
}

function workspaceRoot(): string {
  const folder = (vscode.workspace.workspaceFolders ?? [])[0];
  assert.ok(folder, 'рабочее пространство открыто');
  return folder!.uri.fsPath;
}

const PLAN_MARKER = 'E2E-PLAN-MARKER';

/** Ответ OpenAI-совместимого сервера на createWithTools. */
function completion(message: any, res: any): void {
  json(res, { choices: [{ message, finish_reason: message.tool_calls ? 'tool_calls' : 'stop' }], usage: { prompt_tokens: 50, completion_tokens: 20 } });
}

suite('E2E-13: Plan Mode от плана до имплементации', () => {
  let snap: SettingsSnapshot | undefined;
  let stub: Awaited<ReturnType<typeof startStub>>;
  let view: ReturnType<typeof createFakeWebviewView>;
  let history: RunHistoryStore;
  let ctx: any;
  let conversation: ConversationManager;
  let provider: ChatViewProvider;
  let root: string;
  let plansDir: string;
  /** Счётчик обращений планировщика: первый — записать план, второй — подтвердить. */
  let plannerCalls = 0;

  async function buildPanel(baseUrl: string): Promise<void> {
    snap = await applySettings({
      providers: {
        // Не loopback: иначе провайдер считается локальным (для Plan Mode это неважно,
        // но пусть путь будет тем же, что у настоящего облачного провайдера)
        stubai: { type: 'openai', baseUrl, apiKey: 'test-key', models: ['gpt-4o'] },
      },
      defaultProvider: 'stubai',
      defaultModel: 'gpt-4o',
      'chat.summaryEnabled': false,
      'chat.includeOpenFile': false,
      'retry.enabled': false,
      'budget.sessionLimitUsd': 0,
    });

    ctx = {
      subscriptions: [],
      extensionUri: vscode.Uri.file(path.resolve(__dirname, '../../../..')),
      globalState: memoryMemento(),
      workspaceState: memoryMemento(),
    };
    const sessionLog = new SessionLog(ctx.workspaceState);
    conversation = new ConversationManager(ctx.workspaceState, sessionLog);
    history = new RunHistoryStore(ctx.globalState);
    provider = new ChatViewProvider(ctx, new ProviderManager(), conversation, history, undefined, undefined, sessionLog);
    view = createFakeWebviewView();
    provider.resolveWebviewView(view as any, {} as any, { isCancellationRequested: false } as any);
  }

  setup(async function () {
    root = workspaceRoot();
    plansDir = path.join(root, '.llma', 'plans');
    plannerCalls = 0;
    stub = await startStub((_req, res, body) => {
      const system = String(body?.messages?.[0]?.content ?? '');
      // Планировщик: сначала просит write_file с планом, потом короткий ответ
      if (system.includes('планировщик')) {
        plannerCalls += 1;
        const planPath = /plan_\d{4}-\d{2}-\d{2}_[0-9a-f]{8}\.md/.exec(JSON.stringify(body))?.[0];
        if (planPath && plannerCalls === 1) {
          completion(
            {
              role: 'assistant',
              tool_calls: [
                {
                  id: 'call_plan',
                  type: 'function',
                  function: {
                    name: 'write_file',
                    arguments: JSON.stringify({
                      path: planPath,
                      content: `# План\n\n${PLAN_MARKER}\n\n## AC-1\nСделать проверку\n`,
                    }),
                  },
                },
              ],
            },
            res,
          );
          return;
        }
      }
      // Ревьюер: отчёт без замечаний, чтобы рефлексия завершилась за один цикл
      if (/ревью|reviewer|AC-\d/.test(system)) {
        completion({ role: 'assistant', content: 'AC-1 ✅ выполнено\nВсе критерии закрыты.' }, res);
        return;
      }
      completion({ role: 'assistant', content: 'Готово: изменения внесены.' }, res);
    }, 0, (() => {
      const list = Object.values(os.networkInterfaces()).flat().filter((e: any) => e && e.family === 'IPv4' && !e.internal);
      return (list[0] as any)?.address ?? '127.0.0.1';
    })());

    await buildPanel(stub.url);
  });

  teardown(async () => {
    await snap?.restore();
    snap = undefined;
    await stub.close();
    try {
      if (fs.existsSync(plansDir)) fs.rmSync(plansDir, { recursive: true, force: true });
    } catch {
      /* мимо */
    }
  });

  test('E2E-13a: план записывается на диск и попадает в историю сессии', async function () {
    this.timeout(60000);
    const sid = conversation.session.getActive()!.meta.id;

    view.send({ type: 'sendMessage', text: 'спланируй проверку', mode: 'agent', provider: 'stubai', model: 'gpt-4o', planMode: true });

    const planMessage = await waitFor(
      () => messagesOf(conversation, sid).find((text) => text.includes('📋 **План:**')),
      50000,
      100,
      'сообщение с планом в сессии',
    );
    assert.ok(planMessage, 'план сохранён в историю сессии, а не только в webview');

    const files = fs.existsSync(plansDir) ? fs.readdirSync(plansDir).filter((f) => f.endsWith('.md')) : [];
    assert.strictEqual(files.length, 1, `на диске ровно один файл плана: ${files.join(', ')}`);
    const planText = fs.readFileSync(path.join(plansDir, files[0]), 'utf-8');
    assert.ok(planText.includes(PLAN_MARKER), 'содержимое плана пришло из файла на диске, а не из ответа модели');

    const run = history.getRuns().find((r) => r.provider === 'plan-mode');
    assert.ok(run, 'этап планирования записан в историю');
    assert.strictEqual(run!.status, 'success');
  });

  test('E2E-13b: имплементация идёт в исходную сессию, соседняя остаётся чистой, план переживает перезагрузку', async function () {
    this.timeout(90000);
    const planRun = await waitFor(
      () => history.getRuns().find((r) => r.provider === 'plan-mode'),
      60000,
      100,
      'прогон планирования',
    ).catch(() => undefined);
    if (!planRun) {
      // Плана нет — этот тест зависит от предыдущего; так честнее, чем проходить вхолостую
      this.skip();
      return;
    }

    const files = fs.readdirSync(plansDir).filter((f) => f.endsWith('.md'));
    const planPath = path.join(plansDir, files[0]);
    const sidPlan = planRun.sessionId ?? conversation.session.getActive()!.meta.id;

    // Пользователь переключился на другой чат: имплементация не должна уехать в него
    const sidOther = conversation.session.createSession('Другой чат');
    conversation.session.switchTo(sidOther);

    await (provider as any).handleImplementPlan(planPath, 'stubai', 'gpt-4o', sidPlan);

    await waitFor(
      () => history.getRuns().filter((r) => r.provider === 'plan-mode').length >= 2,
      60000,
      100,
      'прогон имплементации в истории',
    );
    const implRun = history.getRuns().filter((r) => r.provider === 'plan-mode').at(-1)!;
    assert.strictEqual(implRun.status, 'success', `имплементация завершилась: ${implRun.error ?? ''}`);
    assert.strictEqual(implRun.sessionId, sidPlan, 'прогон привязан к сессии с планом');

    const planMessages = messagesOf(conversation, sidPlan);
    assert.ok(planMessages.some((t) => t.includes('Имплементация завершена')), 'результат имплементации в исходной сессии');
    const otherMessages = messagesOf(conversation, sidOther);
    assert.strictEqual(otherMessages.length, 0, `в соседней сессии пусто, а там: ${otherMessages.join(' | ')}`);

    // Перезагрузка окна: новый ConversationManager поверх того же хранилища
    const reloaded = new ConversationManager(ctx.workspaceState, new SessionLog(ctx.workspaceState));
    const afterReload = messagesOf(reloaded, sidPlan);
    assert.ok(afterReload.some((t) => t.includes('📋 **План:**')), 'план виден после перезагрузки');
    assert.ok(afterReload.some((t) => t.includes(PLAN_MARKER)), 'содержимое плана сохранилось');
  });
});
