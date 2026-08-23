// Тесты ChatViewProvider.handleSendMessage — полный мок vscode + ProviderManager + LLM-провайдера.
// Покрывает: сессионную маршрутизацию, историю со старта (running → final), отсутствие двойной записи в Plan Mode.

import 'mocha';
import * as sinon from 'sinon';
import * as vscode from 'vscode';
import * as assert from 'assert';
import * as path from 'path';
import { ChatViewProvider } from '../../src/modes/chat/ChatViewProvider';
import { ConversationManager } from '../../src/modes/chat/ConversationManager';
import { RunHistoryStore } from '../../src/shared/RunHistoryStore';
import { PlanModeManager } from '../../src/modes/chat/PlanModeManager';
import { AgentOrchestrator } from '../../src/modes/apply/AgentOrchestrator';
import { SessionLog } from '../../src/shared/SessionLog';

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

  test('restoreTokenIndicator: восстанавливает токены последнего запуска сессии', () => {
    const id1 = cm.session.getActive()!.meta.id;
    history.recordRun({
      id: 'run1', timestamp: Date.now(), mode: 'agent', task: 'задача',
      provider: 'test', model: 'm', steps: 1, tokensIn: 100, tokensOut: 50,
      cost: 0.01, duration: 100, status: 'success', sessionId: id1,
    });

    const spy = sandbox.spy(provider as any, 'postMessage');
    (provider as any).restoreTokenIndicator(id1);

    const call = spy.getCalls().find((c: any) => c.args[0]?.type === 'tokens');
    assert.ok(call, 'должен быть вызов tokens');
    assert.strictEqual(call.args[0].inputTokens, 100);
    assert.strictEqual(call.args[0].outputTokens, 50);
  });

  test('restoreTokenIndicator: без запусков в сессии — сброс в 0', () => {
    const id1 = cm.session.getActive()!.meta.id;
    const spy = sandbox.spy(provider as any, 'postMessage');
    (provider as any).restoreTokenIndicator(id1);

    const call = spy.getCalls().find((c: any) => c.args[0]?.type === 'tokens');
    assert.ok(call, 'должен быть вызов tokens');
    assert.strictEqual(call.args[0].inputTokens, 0);
    assert.strictEqual(call.args[0].outputTokens, 0);
  });

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

    // План персистится в сессию (фикс потери результата при переключении чата)
    const msgs = cm.getMessages();
    assert.strictEqual(msgs.length, 2, 'user + assistant(план)');
    assert.ok(msgs[1].content.includes('# План'), 'план сохранён в сессию');
  });

  test('handleImplementPlan: персистит имплементацию и рефлексию в исходную сессию', async () => {
    sandbox.stub(PlanModeManager.prototype, 'implementPlan').resolves({
      orchestratorResult: { workers: [{ roleName: 'coder' }] },
    } as any);
    sandbox.stub(PlanModeManager.prototype, 'reflect').resolves({
      report: 'AC-1 ✅ пройден',
      allPassed: true,
      cycles: 1,
      summary: 'всё готово',
    } as any);

    const id1 = cm.session.getActive()!.meta.id;
    await (provider as any).handleImplementPlan('/tmp/plan.md', undefined, undefined, id1);

    // Одна запись success в исходной сессии
    const runs = history.getRuns();
    assert.strictEqual(runs.length, 1);
    assert.strictEqual(runs[0].status, 'success');
    assert.strictEqual(runs[0].sessionId, id1);

    // Персистились: имплементация + рефлексия (не потеряются при переключении чата)
    const msgs = cm.getMessages();
    assert.strictEqual(msgs.length, 2, 'имплементация + рефлексия');
    assert.ok(msgs[0].content.includes('Имплементация завершена'));
    assert.ok(msgs[1].content.includes('Рефлексия пройдена'));
    assert.ok(msgs[1].content.includes('AC-1 ✅'));
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

  test('@orchestrate: limitExceeded-воркер → статус limit_exceeded (не success)', async () => {
    sandbox.stub(AgentOrchestrator.prototype, 'execute').resolves({
      taskId: 'orch_2',
      strategy: 'sequential',
      workers: [
        { roleName: 'coder', result: { answer: 'Агент не дал финального ответа (исчерпан лимит итераций).', steps: [], iterations: 20, inputTokens: 100, outputTokens: 0, cost: 0.001, limitExceeded: true } },
      ],
      totalInputTokens: 100,
      totalOutputTokens: 0,
      totalCost: 0.001,
      costPerWorker: { coder: 0.001 },
      success: false,
      summary: 'coder ⚠️',
    });

    const id1 = cm.session.getActive()!.meta.id;
    await send('@orchestrate сделай модуль', 'agent', false, id1);

    const runs = history.getRuns();
    assert.strictEqual(runs.length, 1);
    assert.strictEqual(runs[0].status, 'limit_exceeded', 'воркер без финального ответа → limit_exceeded');
    assert.strictEqual(runs[0].provider, 'orchestrator');
  });

  // ===== Отмена: AbortError → cancelled (не error) =====

  test('Plan Mode: AbortError → cancelled (не «Ошибка планирования»)', async () => {
    const abortErr: any = new Error('Request was aborted');
    abortErr.name = 'AbortError';
    sandbox.stub(PlanModeManager.prototype, 'generatePlan').rejects(abortErr);
    wsFolders = [{ uri: { fsPath: '/tmp' } }];

    const postMessage = sandbox.stub();
    (provider as any).view = { webview: { postMessage }, show: sandbox.stub() };

    const id1 = cm.session.getActive()!.meta.id;
    await send('составь план', 'agent', true, id1);

    const types = postMessage.getCalls().map(c => c.args[0]?.type);
    assert.ok(types.includes('cancelled'), 'должен быть cancelled');
    assert.ok(!types.includes('error'), 'не должно быть error');
    assert.strictEqual(history.getRuns()[0].status, 'cancelled');
  });

  test('handleImplementPlan: AbortError → cancelled (не «Ошибка имплементации»)', async () => {
    const abortErr: any = new Error('Request was aborted');
    abortErr.name = 'AbortError';
    sandbox.stub(PlanModeManager.prototype, 'implementPlan').rejects(abortErr);

    const postMessage = sandbox.stub();
    (provider as any).view = { webview: { postMessage }, show: sandbox.stub() };

    const id1 = cm.session.getActive()!.meta.id;
    await (provider as any).handleImplementPlan('/tmp/plan.md', undefined, undefined, id1);

    const types = postMessage.getCalls().map(c => c.args[0]?.type);
    assert.ok(types.includes('cancelled'), 'должен быть cancelled');
    assert.ok(!types.includes('error'), 'не должно быть error');
    assert.strictEqual(history.getRuns()[0].status, 'cancelled');
  });

  test('@orchestrate: AbortError → cancelled (не ошибка)', async () => {
    const abortErr: any = new Error('Request was aborted');
    abortErr.name = 'AbortError';
    sandbox.stub(AgentOrchestrator.prototype, 'execute').rejects(abortErr);

    const postMessage = sandbox.stub();
    (provider as any).view = { webview: { postMessage }, show: sandbox.stub() };

    const id1 = cm.session.getActive()!.meta.id;
    await send('@orchestrate сделай модуль', 'agent', false, id1);

    const types = postMessage.getCalls().map(c => c.args[0]?.type);
    assert.ok(types.includes('cancelled'), 'должен быть cancelled');
    assert.ok(!types.includes('error'), 'не должно быть error');
    assert.strictEqual(history.getRuns()[0].status, 'cancelled');
  });

  test('агент: AbortError из createWithTools → cancelled', async () => {
    mockLLM.createWithTools = sinon.stub().callsFake(async () => {
      const e: any = new Error('Request was aborted');
      e.name = 'AbortError';
      throw e;
    });

    const postMessage = sandbox.stub();
    (provider as any).view = { webview: { postMessage }, show: sandbox.stub() };

    const id1 = cm.session.getActive()!.meta.id;
    await send('сделай задачу', 'agent', false, id1);

    const types = postMessage.getCalls().map(c => c.args[0]?.type);
    assert.ok(types.includes('cancelled'), 'должен быть cancelled');
    assert.ok(!types.includes('error'), 'не должно быть error');
    assert.strictEqual(history.getRuns()[0].status, 'cancelled');
  });

  // ===== F1: getTranscript + refreshSessionList =====

  test('getTranscript → sessionTranscript с текстом из session-log', async () => {
    const sessionLog = new SessionLog(storage);
    const sid = 'session_transcript_test';
    sessionLog.append({ sessionId: sid, ts: 1, type: 'user/message', content: 'привет' });
    (provider as any).sessionLog = sessionLog;
    const postMessage = sandbox.stub();
    (provider as any).view = { webview: { postMessage } };

    await (provider as any).handleWebviewMessage({ type: 'getTranscript', sessionId: sid, action: 'copy' });

    assert.ok(postMessage.calledOnce, 'postMessage вызван один раз');
    const msg = postMessage.getCall(0).args[0];
    assert.strictEqual(msg.type, 'sessionTranscript');
    assert.strictEqual(msg.action, 'copy');
    assert.ok(msg.text.includes(`# Сессия: ${sid}`), 'заголовок транскрипции');
    assert.ok(msg.text.includes('привет'), 'текст события из лога');
  });

  test('refreshSessionList(): шлёт sessionList + history в WebView', () => {
    const postMessage = sandbox.stub();
    (provider as any).view = { webview: { postMessage } };

    (provider as any).refreshSessionList();

    const types = postMessage.getCalls().map((c: any) => c.args[0].type);
    assert.ok(types.includes('sessionList'), 'sessionList отправлен');
    assert.ok(types.includes('history'), 'history отправлен');
  });

  test('clearAllSessions → executeCommand("llmAssistant.clearAllSessions")', async () => {
    const executeCommand = sandbox.stub(vscode.commands, 'executeCommand').resolves(undefined);

    await (provider as any).handleWebviewMessage({ type: 'clearAllSessions' });

    assert.ok(executeCommand.calledOnce, 'executeCommand вызван один раз');
    assert.ok(executeCommand.calledWith('llmAssistant.clearAllSessions'), 'с правильным именем команды');
  });

  test('toggleFavorite: переключает избранное и пересылает sessionList', async () => {
    const postMessage = sandbox.stub();
    (provider as any).view = { webview: { postMessage } };

    const sid = cm.session.getActive()!.meta.id;
    await (provider as any).handleWebviewMessage({ type: 'toggleFavorite', sessionId: sid });

    assert.strictEqual(cm.session.getActive()!.meta.favorite, true, 'избранное включено');

    const msg = postMessage.getCalls().map((c: any) => c.args[0]).find((m: any) => m.type === 'sessionList');
    assert.ok(msg, 'sessionList переслан');
    const s = msg.sessions.find((x: any) => x.id === sid);
    assert.strictEqual(s.favorite, true, 'favorite проставлен в sessionList');
  });

  test('sendSessionListToWebview: обогащает сессии превью из session-log', () => {
    const postMessage = sandbox.stub();
    (provider as any).view = { webview: { postMessage } };

    const sid = cm.session.getActive()!.meta.id;
    const sessionLog = new SessionLog(storage);
    sessionLog.append({ sessionId: sid, ts: 1, type: 'user/message', content: 'Как написать юнит-тест?' });
    (provider as any).sessionLog = sessionLog;

    (provider as any).sendSessionListToWebview();

    const msg = postMessage.getCall(0).args[0];
    const s = msg.sessions.find((x: any) => x.id === sid);
    assert.ok(s, 'сессия в sessionList');
    assert.strictEqual(s.preview, 'Как написать юнит-тест?', 'превью из последнего сообщения');
  });

  test('getHtmlForWebview: инжектит webview-ресурсы без незаменённых плейсхолдеров (P0-6.1)', () => {
    // Указываем реальный корень репо, чтобы getHtmlForWebview читал настоящие файлы webview
    const realRoot = path.resolve(__dirname, '../../..');
    (provider as any).context.extensionUri = vscode.Uri.file(realRoot);

    const html = (provider as any).getHtmlForWebview();

    assert.ok(!html.includes('{{'), 'нет незаменённых {{...}}-плейсхолдеров');
    assert.ok(html.includes('TOOLBAR_ACTIONS'), 'toolbar.js инжектирован ({{TOOLBAR}})');
    assert.ok(html.includes('TOOL_ACTIVITY'), 'toolActivity.js инжектирован ({{TOOLACTIVITY}})');
    assert.ok(html.includes('id="session-sidebar"'), 'сайдбар сессий в разметке (P0-2)');
    assert.ok(html.includes('id="input-toolbar"'), 'input-toolbar в разметке (P0-4)');
    assert.ok(html.includes('id="header-actions"'), 'header-actions в разметке (P0-1)');
  });
});
