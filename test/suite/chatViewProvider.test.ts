// Тесты ChatViewProvider.handleSendMessage — полный мок vscode + ProviderManager + LLM-провайдера.
// Покрывает: сессионную маршрутизацию, историю со старта (running → final), отсутствие двойной записи в Plan Mode.

import 'mocha';
import * as sinon from 'sinon';
import * as vscode from 'vscode';
import * as assert from 'assert';
import { ChatViewProvider } from '../../src/modes/chat/ChatViewProvider';
import { ConversationManager } from '../../src/modes/chat/ConversationManager';
import { RunHistoryStore } from '../../src/shared/RunHistoryStore';
import { PlanModeManager } from '../../src/modes/chat/PlanModeManager';
import { AgentOrchestrator } from '../../src/modes/apply/AgentOrchestrator';

/** Асинхронный генератор чанков — имитация стриминга LLM */
async function* chunks(...parts: string[]): AsyncIterable<string> {
  for (const p of parts) yield p;
}

suite('ChatViewProvider.handleSendMessage', () => {
  let sandbox: sinon.SinonSandbox;
  let storage: any;
  let globalState: any;
  let cm: ConversationManager;
  let history: RunHistoryStore;
  let provider: ChatViewProvider;
  let mockLLM: any;
  let wsFolders: any = undefined;

  setup(() => {
    sandbox = sinon.createSandbox();

    // ── vscode.workspace ──
    const config = {
      get: sandbox.fake((key: string, defaultValue?: unknown) => {
        if (key === 'chat.maxContextTokens') return 4096;
        if (key === 'chat.systemPrompt') return '';
        if (key === 'chat.summaryEnabled') return false;
        if (key === 'chat.includeOpenFile') return false;
        if (key === 'chat.agentSystemPrompt') return '';
        if (key === 'defaultProvider') return 'test';
        if (key === 'defaultModel') return 'test-model';
        if (key === 'providers') return {};
        return defaultValue;
      }),
      has: sandbox.fake(() => false),
      inspect: sandbox.fake(() => undefined),
      update: sandbox.fake(() => Promise.resolve()),
    };
    sandbox.stub(vscode.workspace, 'getConfiguration').returns(config as any);
    wsFolders = undefined;
    sandbox.stub(vscode.workspace, 'workspaceFolders').get(() => wsFolders);
    sandbox.stub(vscode.workspace, 'onDidChangeConfiguration').returns({ dispose: () => {} } as any);
    sandbox.stub(vscode.workspace, 'onDidChangeTextDocument').returns({ dispose: () => {} } as any);
    sandbox.stub(vscode.workspace, 'onDidCreateFiles').returns({ dispose: () => {} } as any);
    sandbox.stub(vscode.workspace, 'onDidDeleteFiles').returns({ dispose: () => {} } as any);

    // ── vscode.window ──
    const outputChannel = { appendLine: () => {}, append: () => {}, show: () => {}, hide: () => {}, clear: () => {}, replace: () => {}, dispose: () => {} };
    sandbox.stub(vscode.window, 'createOutputChannel').returns(outputChannel as any);

    // ── Хранилища ──
    storage = {
      get: sandbox.stub().callsFake((_key: string, def: unknown) => def),
      update: sandbox.stub().returns(Promise.resolve()),
      keys: sandbox.stub().returns([]),
      setKeysForSync: sandbox.stub(),
    };
    globalState = (() => {
      let runStorage: any[] = [];
      return {
        get: sandbox.stub().callsFake((_key: string, def: unknown) => runStorage.length > 0 ? runStorage : def),
        update: sandbox.stub().callsFake((_key: string, value: any) => { runStorage = Array.isArray(value) ? [...value] : value; return Promise.resolve(); }),
        keys: sandbox.stub().returns([]),
        setKeysForSync: sandbox.stub(),
      };
    })();

    cm = new ConversationManager(storage);
    history = new RunHistoryStore(globalState);

    // ── Mock LLM-провайдер ──
    mockLLM = {
      chat: (_messages: any, _opts: any, _signal?: AbortSignal, _onRetry?: any) => chunks('Ответ: ', 'тест'),
      chatWithVision: () => chunks('vision-ответ'),
      createWithTools: undefined, // для chat-режима и проверки ошибки агента
    };

    // ── Mock ProviderManager ──
    const pm: any = {
      getProvider: () => mockLLM,
      getDefault: () => mockLLM,
      pricingMap: new Map(),
      refresh: () => {},
    };

    // ── Mock ExtensionContext ──
    const ctx: any = {
      subscriptions: { push: sandbox.stub() },
      extensionUri: vscode.Uri.file('/tmp'),
      workspaceState: storage,
      globalState: globalState,
      extensionPath: '/tmp',
      asAbsolutePath: (p: string) => p,
    };

    // ── Mock OrchestratorViewProvider ──
    const orchestratorView: any = {
      showTask: sandbox.stub(),
      updateWorker: sandbox.stub(),
    };

    provider = new ChatViewProvider(ctx, pm, cm, history, undefined, orchestratorView);
  });

  teardown(() => sandbox.restore());

  /** Вызвать приватный handleSendMessage */
  function send(text: string, mode = 'chat', planMode = false, sessionId?: string): Promise<void> {
    return (provider as any).handleSendMessage(text, mode, undefined, undefined, planMode, sessionId);
  }

  test('chat-режим: одна запись success в указанной сессии (без «сирот»)', async () => {
    const id1 = cm.session.getActive()!.meta.id;

    await send('привет', 'chat', false, id1);

    // История: ровно одна запись, running → success
    const runs = history.getRuns();
    assert.strictEqual(runs.length, 1, 'должна быть ровно одна запись (нет осиротевшей running)');
    assert.strictEqual(runs[0].status, 'success');
    assert.strictEqual(runs[0].sessionId, id1);
    assert.strictEqual(runs[0].mode, 'chat');

    // Сообщения: user + assistant
    const msgs = cm.getMessages();
    assert.strictEqual(msgs.length, 2);
    assert.strictEqual(msgs[0].content, 'привет');
    assert.strictEqual(msgs[1].content, 'Ответ: тест');
  });

  test('сессионная маршрутизация: сообщение из A не попадает в активную сессию B', async () => {
    const id1 = cm.session.createSession('Первая');
    cm.session.createSession('Вторая'); // активная — «Вторая»

    await send('сообщение в первую', 'chat', false, id1);

    // Активная (id2) — пусто
    assert.strictEqual(cm.getMessages().length, 0, 'активная сессия не должна получить чужое сообщение');

    // id1 — user + assistant
    cm.session.switchTo(id1);
    const msgs = cm.getMessages();
    assert.strictEqual(msgs.length, 2);
    assert.strictEqual(msgs[0].content, 'сообщение в первую');
  });

  test('агент без createWithTools: ошибка записана в историю и в сессию', async () => {
    const id1 = cm.session.getActive()!.meta.id;

    await send('сделай задачу', 'agent', false, id1);

    const runs = history.getRuns();
    assert.strictEqual(runs.length, 1);
    assert.strictEqual(runs[0].status, 'error');
    assert.strictEqual(runs[0].error, 'Нет createWithTools');
    assert.strictEqual(runs[0].mode, 'agent');

    // В сессии — user + assistant(ошибка)
    assert.strictEqual(cm.getMessages().length, 2);
    assert.strictEqual(cm.getMessages()[1].role, 'assistant');
  });

  test('Plan Mode без workspace: нет записи в историю (фикс двойного recordRunStart)', async () => {
    const id1 = cm.session.getActive()!.meta.id;

    await send('составь план', 'agent', true, id1);

    // handleSendMessage пропускает recordRunStart (planMode), handlePlanMode возвращается рано без workspace
    assert.strictEqual(history.getRuns().length, 0, 'Plan Mode без workspace не должен создавать запись');

    // Но user-сообщение добавлено
    assert.strictEqual(cm.getMessages().length, 1);
    assert.strictEqual(cm.getMessages()[0].content, 'составь план');
  });

  test('chat-режим: провайдер получает system + user сообщения', async () => {
    let capturedMessages: any[] = [];
    mockLLM.chat = (messages: any) => {
      capturedMessages = messages;
      return chunks('ок');
    };

    const id1 = cm.session.getActive()!.meta.id;
    await send('тест контекста', 'chat', false, id1);

    assert.strictEqual(capturedMessages.length > 0, true);
    assert.strictEqual(capturedMessages[0].role, 'system');
    assert.ok(capturedMessages.some((m: any) => m.role === 'user' && m.content.includes('тест контекста')));
  });

  test('Plan Mode с workspace: одна запись success (без двойной записи)', async () => {
    sandbox.stub(PlanModeManager.prototype, 'generatePlan').resolves({ planPath: '/tmp/plan.md', content: '# План', planId: 'abc' });
    wsFolders = [{ uri: { fsPath: '/tmp' } }];

    const id1 = cm.session.getActive()!.meta.id;
    await send('составь план', 'agent', true, id1);

    // Одна запись — только из handlePlanMode (handleSendMessage пропускает для planMode)
    const runs = history.getRuns();
    assert.strictEqual(runs.length, 1, 'должна быть ровно одна запись (без клона от handleSendMessage)');
    assert.strictEqual(runs[0].status, 'success');
    assert.strictEqual(runs[0].provider, 'plan-mode');
    assert.strictEqual(runs[0].sessionId, id1);
    assert.strictEqual(runs[0].mode, 'agent');
  });

  test('@orchestrate: одна запись success с provider orchestrator + сообщения в сессии', async () => {
    sandbox.stub(AgentOrchestrator.prototype, 'execute').resolves({
      taskId: 'orch_1',
      strategy: 'sequential',
      workers: [
        { roleName: 'architect', result: { answer: 'архитектура', steps: [], iterations: 1, inputTokens: 50, outputTokens: 25, cost: 0.0001 } },
      ],
      totalInputTokens: 100,
      totalOutputTokens: 50,
      totalCost: 0.0001,
      costPerWorker: { architect: 0.0001 },
      success: true,
      summary: 'архитектура',
    });

    const id1 = cm.session.getActive()!.meta.id;
    await send('@orchestrate сделай модуль', 'agent', false, id1);

    // Одна запись success, provider 'orchestrator', сессия id1
    const runs = history.getRuns();
    assert.strictEqual(runs.length, 1);
    assert.strictEqual(runs[0].status, 'success');
    assert.strictEqual(runs[0].provider, 'orchestrator');
    assert.strictEqual(runs[0].sessionId, id1);

    // Сообщения: user (@orchestrate ...) + assistant (summary)
    const msgs = cm.getMessages();
    assert.strictEqual(msgs.length, 2);
    assert.strictEqual(msgs[0].content, '@orchestrate сделай модуль');
    assert.strictEqual(msgs[1].content, 'архитектура');
  });
});
