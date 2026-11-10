// E2E-11: лимит бюджета сессии — отказ отменяет прогон ДО отправки запроса.
// Проверяется то, что нельзя проверить юнитом: живой HTTP-стаб не должен получить
// ни одного запроса, а диалог — показать лимит, прогноз и множитель шагов агента.

import 'mocha';
import * as assert from 'assert';
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

const REPO_ROOT = path.resolve(__dirname, '../../../..');

suite('E2E-11: лимит бюджета отменяет прогон до запроса', () => {
  let snap: SettingsSnapshot | undefined;
  let stub: Awaited<ReturnType<typeof startStub>>;
  let view: ReturnType<typeof createFakeWebviewView>;
  let history: RunHistoryStore;
  const dialogs: string[] = [];
  const originalWarning = vscode.window.showWarningMessage;

  async function buildPanel(baseUrl: string, extra: Record<string, unknown> = {}): Promise<void> {
    snap = await applySettings({
      providers: {
        // isLocal не выставлен намеренно: цена берётся из прайса, иначе прогноз всегда $0
        paid: { type: 'openai', baseUrl, apiKey: 'test-key', models: ['gpt-4o'] },
      },
      defaultProvider: 'paid',
      defaultModel: 'gpt-4o',
      'budget.sessionLimitUsd': 0.000001,
      'chat.summaryEnabled': false,
      'chat.includeOpenFile': false,
      'retry.enabled': false,
      ...extra,
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
    const provider = new ChatViewProvider(ctx, new ProviderManager(), conversation, history, undefined, undefined, sessionLog);
    view = createFakeWebviewView();
    provider.resolveWebviewView(view as any, {} as any, { isCancellationRequested: false } as any);
  }

  setup(async () => {
    dialogs.length = 0;
    // Отказ пользователя: модальный диалог вернул «ничего»
    (vscode.window as any).showWarningMessage = async (msg: string) => {
      dialogs.push(String(msg));
      return undefined;
    };
    stub = await startStub((_req, res) => json(res, { error: 'до сюда доходить не должно' }, 500));
  });

  teardown(async () => {
    (vscode.window as any).showWarningMessage = originalWarning;
    await snap?.restore();
    snap = undefined;
    await stub.close();
  });

  test('E2E-11a: прогноз выше лимита → запрос не ушёл, прогон помечен отменённым', async function () {
    this.timeout(30000);
    await buildPanel(stub.url);

    view.send({ type: 'sendMessage', text: 'привет, это дорогая модель', mode: 'chat', provider: 'paid', model: 'gpt-4o' });

    const run = (await waitFor(
      () => {
        const record = history.getRuns(1)[0];
        return record && record.status !== 'running' ? record : undefined;
      },
      15000,
      50,
      'запись прогона в конечном статусе',
    ))!;
    assert.strictEqual(run.status, 'cancelled', 'прогон отменён, а не отправлен');
    assert.ok(/лимит/i.test(String(run.error ?? '')), `причина отмены про лимит: ${String(run.error)}`);

    assert.ok(!stub.hits['/chat/completions'], 'провайдер не получил ни одного запроса');
    assert.strictEqual(messagesOfType(view, 'done').length, 0, 'панель не получила done');

    const dialog = dialogs.find((d) => /Лимит сессии/.test(d));
    assert.ok(dialog, `диалог о превышении показан, получено: ${dialogs.join(' | ')}`);
    assert.ok(/прогноз \$0\.\d{4}/.test(dialog as string), `в диалоге есть прогноз: ${dialog}`);
    assert.ok(/перерасход \$0\.\d{4}/.test(dialog as string), `в диалоге есть перерасход: ${dialog}`);
  });

  test('E2E-11b: для агента прогноз умножается на число шагов', async function () {
    this.timeout(30000);
    await buildPanel(stub.url, { 'agent.maxIterations': 3 });

    view.send({ type: 'sendMessage', text: 'сделай что-нибудь в проекте', mode: 'agent', provider: 'paid', model: 'gpt-4o' });
    const agentDialog = (await waitFor(
      () => dialogs.find((d) => /шагов агента/.test(d)),
      15000,
      50,
      'диалог с множителем шагов',
    )) as string;

    // Множитель виден в тексте и совпадает с настройкой: иначе лимит обходится ReAct-циклом
    assert.ok(/\(3 шагов агента\)/.test(agentDialog), `шаги агента в диалоге: ${agentDialog}`);
    assert.ok(!stub.hits['/chat/completions'], 'агентный прогон тоже не дошёл до провайдера');
  });
});
