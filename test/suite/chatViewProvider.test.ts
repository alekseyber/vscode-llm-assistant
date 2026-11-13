// Тесты ChatViewProvider.handleSendMessage — полный мок vscode + ProviderManager + LLM-провайдера.
// Покрывает: сессионную маршрутизацию, историю со старта (running → final), отсутствие двойной записи в Plan Mode.

import 'mocha';
import * as sinon from 'sinon';
import * as vscode from 'vscode';
import * as assert from 'assert';
import * as path from 'path';
import { ChatViewProvider, buildProviderListFromConfig, resolveModelForProvider, resolveVisionSupport, visionUnsupportedWarning, todayLocalDate } from '../../src/modes/chat/ChatViewProvider';
import { ConversationManager } from '../../src/modes/chat/ConversationManager';
import { RunHistoryStore } from '../../src/shared/RunHistoryStore';
import { PlanModeManager } from '../../src/modes/chat/PlanModeManager';
import { AgentOrchestrator } from '../../src/modes/apply/AgentOrchestrator';
import { SessionLog, SessionEvent } from '../../src/shared/SessionLog';
import { ProviderManager } from '../../src/providers/manager';
import { OrchestratorViewProvider } from '../../src/modes/orchestrator/OrchestratorViewProvider';
import { ChatMessage, CompletionOptions, LLMProvider, RetryCallback } from '../../src/providers/types';
import {
  MutableExtensionContext,
  fakeConfiguration,
  fakeExtensionContext,
  fakeMemento,
  fakeMultiAgentResult,
  fakeOutputChannel,
  fakeWebviewView,
  fakeWorkspaceFolder,
} from '../support/fakes';

/** Асинхронный генератор чанков — имитация стриминга LLM */
async function* chunks(...parts: string[]): AsyncIterable<string> {
  for (const p of parts) yield p;
}

/**
 * Мок LLM-провайдера: помимо контракта `LLMProvider` нужен `chatWithVision` — vision-ветка
 * ChatViewProvider зовёт его прямо у провайдера, в интерфейс он не входит.
 */
interface MockLLMProvider extends LLMProvider {
  chatWithVision(
    messages: ChatMessage[],
    options: CompletionOptions,
    signal?: AbortSignal,
    onRetry?: RetryCallback,
  ): AsyncIterable<string>;
}

/** Событие ассистента из session-log (для сужения union по `type`) */
type AssistantMessageEvent = Extract<SessionEvent, { type: 'assistant/message' }>;

let noteChosenCalls: Array<[string | undefined, string | undefined]> = [];

suite('ChatViewProvider.handleSendMessage', () => {
  let sandbox: sinon.SinonSandbox;
  let storage: vscode.Memento;
  let globalState: vscode.Memento;
  let cm: ConversationManager;
  let history: RunHistoryStore;
  let provider: ChatViewProvider;
  let mockLLM: MockLLMProvider;
  let wsFolders: readonly vscode.WorkspaceFolder[] | undefined = undefined;
  /** Переопределения настроек для отдельного теста (сбрасываются в setup). */
  let configOverrides: Record<string, unknown> = {};
  /** Ссылки на контекст и менеджер провайдеров — нужны тестам перезапуска окна. */
  let ctxRef: MutableExtensionContext;
  let pmRef: ProviderManager;
  let orchestratorView: OrchestratorViewProvider;

  setup(() => {
    sandbox = sinon.createSandbox();
    noteChosenCalls = [];
    configOverrides = {};

    // ── vscode.workspace ──
    const config = fakeConfiguration((key, defaultValue) => {
      if (key in configOverrides) return configOverrides[key];
      if (key === 'chat.maxContextTokens') return 4096;
      if (key === 'chat.systemPrompt') return '';
      if (key === 'chat.summaryEnabled') return false;
      if (key === 'chat.includeOpenFile') return false;
      if (key === 'chat.agentSystemPrompt') return '';
      if (key === 'defaultProvider') return 'test';
      if (key === 'defaultModel') return 'test-model';
      if (key === 'providers') return {};
      return defaultValue;
    });
    sandbox.stub(vscode.workspace, 'getConfiguration').returns(config);
    wsFolders = undefined;
    sandbox.stub(vscode.workspace, 'workspaceFolders').get(() => wsFolders);
    // Подписки не доставляют событий: расширению важно, что регистрация вернула `Disposable`
    sandbox.stub(vscode.workspace, 'onDidChangeConfiguration').returns({ dispose: () => {} });
    sandbox.stub(vscode.workspace, 'onDidChangeTextDocument').returns({ dispose: () => {} });
    sandbox.stub(vscode.workspace, 'onDidCreateFiles').returns({ dispose: () => {} });
    sandbox.stub(vscode.workspace, 'onDidDeleteFiles').returns({ dispose: () => {} });

    // ── vscode.window ──
    sandbox.stub(vscode.window, 'createOutputChannel').returns(fakeOutputChannel('LLM Assistant'));

    // ── Хранилища ──
    // workspaceState пустой: `get` всегда отдаёт defaultValue, как у расширения без сохранений.
    storage = fakeMemento({ persist: false });
    // Ключи globalState независимы: раньше заглушка хранила одно значение на все ключи,
    // и запись дневного счётчика затирала историю прогонов
    globalState = fakeMemento();

    cm = new ConversationManager(storage);
    history = new RunHistoryStore(globalState);

    // ── Mock LLM-провайдер ──
    mockLLM = {
      name: 'test',
      isLocal: false,
      models: async () => ['test-model'],
      chat: () => chunks('Ответ: ', 'тест'),
      chatWithVision: () => chunks('vision-ответ'),
      createWithTools: undefined, // для chat-режима и проверки ошибки агента
    };

    // ── Mock ProviderManager: настоящий менеджер с подменёнными провайдерами ──
    const pm = new ProviderManager();
    sandbox.stub(pm, 'getProvider').returns(mockLLM);
    sandbox.stub(pm, 'getDefault').returns(mockLLM);
    sandbox.stub(pm, 'refresh');
    sandbox.stub(pm, 'noteChosen').callsFake((providerName, model) => {
      noteChosenCalls.push([providerName, model]);
    });
    sandbox.stub(pm, 'getChosen').returns(undefined);

    // ── ExtensionContext с нашими хранилищами ──
    const ctx = fakeExtensionContext({ workspaceState: storage, globalState });

    // ── Mock OrchestratorViewProvider: методы-пустышки, панель не показывается ──
    orchestratorView = sandbox.createStubInstance(OrchestratorViewProvider);

    ctxRef = ctx;
    pmRef = pm;
    provider = new ChatViewProvider(ctx, pm, cm, history, undefined, orchestratorView);
  });

  teardown(() => sandbox.restore());

  /**
   * Вызвать приватный handleSendMessage.
   * Element access (`provider['…']`) — единственный способ дотянуться до приватного члена
   * из теста без приведения: тип метода при этом проверяется компилятором.
   */
  function send(text: string, mode = 'chat', planMode = false, sessionId?: string): Promise<void> {
    return provider['handleSendMessage'](text, mode, undefined, undefined, planMode, sessionId);
  }

  /**
   * Провайдер с session-log: поле readonly, поэтому журнал внедряется конструктором
   * (так же, как в активации расширения), а не подменой поля после создания.
   */
  function providerWithLog(sessionLog: SessionLog): ChatViewProvider {
    return new ChatViewProvider(ctxRef, pmRef, cm, history, undefined, orchestratorView, sessionLog);
  }

  test('restoreTokenIndicator: восстанавливает токены последнего запуска сессии', () => {
    const id1 = cm.session.getActive()!.meta.id;
    history.recordRun({
      id: 'run1', timestamp: Date.now(), mode: 'agent', task: 'задача',
      provider: 'test', model: 'm', steps: 1, tokensIn: 100, tokensOut: 50,
      cost: 0.01, duration: 100, status: 'success', sessionId: id1,
    });

    const webview = fakeWebviewView();
    provider['view'] = webview.view;
    provider['restoreTokenIndicator'](id1);

    const call = webview.messages.find((m) => m?.type === 'tokens');
    assert.ok(call, 'должен быть вызов tokens');
    assert.strictEqual(call.inputTokens, 100);
    assert.strictEqual(call.outputTokens, 50);
  });

  test('restoreTokenIndicator: без запусков в сессии — сброс в 0', () => {
    const id1 = cm.session.getActive()!.meta.id;
    const webview = fakeWebviewView();
    provider['view'] = webview.view;
    provider['restoreTokenIndicator'](id1);

    const call = webview.messages.find((m) => m?.type === 'tokens');
    assert.ok(call, 'должен быть вызов tokens');
    assert.strictEqual(call.inputTokens, 0);
    assert.strictEqual(call.outputTokens, 0);
  });

  test('SEL-1: смена провайдера в селекторе запоминается сразу (Edit идёт за ней)', async () => {
    await provider['handleWebviewMessage']({ type: 'selectionChanged', provider: 'local', model: 'qwen3:8b' });
    assert.deepStrictEqual(noteChosenCalls.at(-1), ['local', 'qwen3:8b'], 'выбор провайдера запомнен без отправки сообщения');
  });

  test('MR-10: превышение лимита бюджета — запрос не уходит, прогон отменён', async () => {
    const chatSpy = sandbox.spy(mockLLM, 'chat');
    sandbox.stub(vscode.window, 'showWarningMessage').resolves(undefined); // пользователь отказался
    configOverrides['budget.sessionLimitUsd'] = 0.000001;
    configOverrides['maxTokens'] = 4096;
    // Расход сессии уже есть: 0.01 при лимите 0.000001
    const sid = cm.session.getActive()!.meta.id;
    history.recordRun({
      id: 'prev', timestamp: Date.now(), mode: 'chat', task: 'ранее', provider: 'test', model: 'm',
      steps: 1, tokensIn: 100, tokensOut: 100, cost: 0.01, duration: 10, status: 'success', sessionId: sid,
    });

    await send('привет', 'chat');

    assert.strictEqual(chatSpy.callCount, 0, 'запрос к модели не отправлялся');
    const last = history.getRuns().find((r) => r.status === 'cancelled');
    assert.ok(last, 'прогон помечен отменённым');
  });

  test('MR-11: резерв бюджета снимается после прогона (не накапливается)', async () => {
    configOverrides['budget.sessionLimitUsd'] = 1;
    configOverrides['maxTokens'] = 512;

    await send('привет', 'chat');

    const reserved: Map<string, number> = provider['budgetReserved'];
    assert.strictEqual(reserved.size, 0, `резерв должен быть снят, осталось ${reserved.size}`);
  });

  test('MR-16: лимит сессии останавливает агентский прогон посреди цикла', async () => {
    // Прогноз укладывается в лимит (иначе вопрос до отправки), а фактический расход шага — нет
    configOverrides['budget.sessionLimitUsd'] = 0.01;
    configOverrides['maxTokens'] = 128;
    configOverrides['agent.maxIterations'] = 5;
    mockLLM.createWithTools = async () => ({
      choices: [{
        message: {
          role: 'assistant',
          tool_calls: [{ id: `c${Math.random()}`, type: 'function', function: { name: 'read_file', arguments: '{"path":"a.txt"}' } }],
        },
      }],
      usage: { prompt_tokens: 100_000, completion_tokens: 100_000 },
    });

    const webview = fakeWebviewView();
    provider['view'] = webview.view;
    await send('читай файл', 'agent');

    const run = history.getRuns()[0];
    assert.strictEqual(run.status, 'limit_exceeded', `агентский прогон остановлен лимитом: ${run.status}`);
    assert.match(String(run.error), /Лимит сессии/, `причина с числами: ${run.error}`);
    assert.strictEqual(run.steps, 1, 'остановка после первого шага, а не после maxIterations');
    const errors = webview.messages
      .filter((msg) => msg?.type === 'error')
      .map((msg) => String(msg.text))
      .join(' | ');
    assert.match(errors, /Лимит сессии/, `пользователь видит причину в панели: ${errors}`);
  });

  test('MR-17: два прогона подряд суммируются в дневном счётчике, расход не теряется', async () => {
    configOverrides['maxTokens'] = 512;
    await send('первый', 'chat');
    const afterFirst = provider.getDailySpend().usd;
    await send('второй', 'chat');

    const afterSecond = provider.getDailySpend().usd;
    assert.ok(afterFirst > 0, `первый прогон учтён: ${afterFirst}`);
    assert.ok(afterSecond > afterFirst, `второй прогон добавлен, а не затёр первый: ${afterFirst} → ${afterSecond}`);
    // Сумма должна совпасть с суммой стоимостей записей истории
    const sumRuns = history.getRuns().reduce((s, r) => s + (r.cost || 0), 0);
    assert.ok(Math.abs(afterSecond - sumRuns) < 1e-9, `счётчик ${afterSecond} = сумме прогонов ${sumRuns}`);
  });

  test('MR-18: битое значение счётчика (NaN) не отравляет дневной лимит', async () => {
    await globalState.update('llmAssistant.dailySpend', { date: todayLocalDate(), usd: Number.NaN });

    assert.strictEqual(provider.getDailySpend().usd, 0, 'NaN трактуется как «сегодня 0»');
    configOverrides['maxTokens'] = 512;
    await send('привет', 'chat');
    assert.ok(provider.getDailySpend().usd > 0, 'после прогона счётчик снова числовой');
  });

  test('MR-14: дневной лимит блокирует запрос до отправки (новая сессия не обнуляет)', async () => {
    const chatSpy = sandbox.spy(mockLLM, 'chat');
    sandbox.stub(vscode.window, 'showWarningMessage').resolves(undefined); // отказ
    configOverrides['budget.dailyLimitUsd'] = 0.005;
    // Сегодня уже потрачено больше лимита — дневной счётчик общий для всех сессий
    await globalState.update('llmAssistant.dailySpend', { date: todayLocalDate(), usd: 0.01 });
    cm.session.createSession('Новая сессия'); // сессионный счётчик здесь пуст

    await send('привет', 'chat');

    assert.strictEqual(chatSpy.callCount, 0, 'запрос не ушёл: дневной лимит не зависит от сессии');
    const blocked = history.getRuns().find((r) => r.status === 'limit_exceeded');
    assert.ok(blocked, 'прогон помечен как превышение лимита');
    assert.match(String(blocked!.error), /дневн/i, `причина про дневной лимит: ${blocked!.error}`);
  });

  test('MR-15: фактический расход попадает в дневной счётчик и виден новому окну', async () => {
    configOverrides['maxTokens'] = 512;
    await send('привет', 'chat');

    // Формат после 0.23.9: расход в микро-долларах + ревизия (см. specs/dailySpend.md)
    const stored = globalState.get('llmAssistant.dailySpend') as { date: string; usdMicro: number; rev: number };
    assert.ok(stored, 'дневной счётчик записан в globalState');
    assert.ok(stored.usdMicro > 0, `расход учтён: ${stored.usdMicro} микро-$`);
    assert.ok(stored.rev >= 1, `ревизия растёт: ${stored.rev}`);
    assert.strictEqual(stored.date, todayLocalDate(), 'счётчик привязан к локальной дате пользователя, не к UTC');

    // Перезапуск окна: новый провайдер поверх того же globalState видит расход
    const reloaded = new ChatViewProvider(ctxRef, pmRef, cm, history, undefined, undefined);
    assert.ok(reloaded.getDailySpend().usd > 0, 'расход переживает перезапуск');
    reloaded.resetDailySpend();
    assert.strictEqual(reloaded.getDailySpend().usd, 0, 'команда сброса обнуляет счётчик');
  });

  test('MR-12: в историю пишется прогноз стоимости, который видел пользователь', async () => {
    configOverrides['maxTokens'] = 512;

    await send('привет', 'chat');

    const run = history.getRuns()[0];
    assert.ok(typeof run.forecastUsd === 'number', 'прогноз сохранён в записи прогона');
    assert.ok((run.forecastUsd as number) > 0, `прогноз должен быть больше нуля, получено ${run.forecastUsd}`);
    assert.ok(!run.autoModel, 'без routing.auto пометки авто-выбора нет');
  });

  test('MR-13: модель, выбранная роутером, помечена в истории вместе с причиной', async () => {
    configOverrides['maxTokens'] = 512;
    configOverrides['routing.auto'] = true;
    configOverrides['routing.simpleModel'] = 'simple-x';
    configOverrides['routing.complexModel'] = 'complex-x';

    await send('привет', 'chat'); // короткий текст → простая задача

    const run = history.getRuns()[0];
    assert.strictEqual(run.autoModel, true, 'пометка авто-выбора в истории');
    assert.strictEqual(run.model, 'simple-x', 'модель подставлена роутером');
    assert.match(String(run.routeReason), /простая задача/, `причина решения в истории: ${run.routeReason}`);
    // Прогноз считается уже по подставленной модели — иначе цифра в диалоге врёт
    assert.ok((run.forecastUsd as number) > 0, 'прогноз сохранён и для авто-выбора');
  });

  test('CVP-6: в историю попадает расход от сервера, а не оценка по символам', async () => {
    // Провайдер отдаёт usage, как локальный движок; текст ответа короткий,
    // а промпт длинный — оценка по символам дала бы совсем другие цифры.
    mockLLM.chat = (_messages, options) => (async function* () {
      options.onUsage?.({ input: 258, output: 40 });
      yield 'ок';
    })();

    await send('очень длинный вопрос '.repeat(200), 'chat');

    const run = history.getRuns()[0];
    assert.strictEqual(run.tokensIn, 258, 'вход — счётчик сервера');
    assert.strictEqual(run.tokensOut, 40, 'выход — счётчик сервера');
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
    let capturedMessages: ChatMessage[] = [];
    mockLLM.chat = (messages) => {
      capturedMessages = messages;
      return chunks('ок');
    };

    const id1 = cm.session.getActive()!.meta.id;
    await send('тест контекста', 'chat', false, id1);

    assert.strictEqual(capturedMessages.length > 0, true);
    assert.strictEqual(capturedMessages[0].role, 'system');
    assert.ok(capturedMessages.some((m) => m.role === 'user' && m.content.includes('тест контекста')));
  });

  test('Plan Mode с workspace: одна запись success (без двойной записи)', async () => {
    sandbox.stub(PlanModeManager.prototype, 'generatePlan').resolves({ planPath: '/tmp/plan.md', content: '# План', planId: 'abc' });
    wsFolders = [fakeWorkspaceFolder('/tmp')];

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
      orchestratorResult: fakeMultiAgentResult({ workers: [{ roleName: 'coder' }] }),
    });
    sandbox.stub(PlanModeManager.prototype, 'reflect').resolves({
      report: 'AC-1 ✅ пройден',
      allPassed: true,
      cycles: 1,
      summary: 'всё готово',
    });

    const id1 = cm.session.getActive()!.meta.id;
    await provider['handleImplementPlan']('/tmp/plan.md', undefined, undefined, id1);

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
    const abortErr = new Error('Request was aborted');
    abortErr.name = 'AbortError';
    sandbox.stub(PlanModeManager.prototype, 'generatePlan').rejects(abortErr);
    wsFolders = [fakeWorkspaceFolder('/tmp')];

    const webview = fakeWebviewView();
    provider['view'] = webview.view;

    const id1 = cm.session.getActive()!.meta.id;
    await send('составь план', 'agent', true, id1);

    const types = webview.messages.map((m) => m?.type);
    assert.ok(types.includes('cancelled'), 'должен быть cancelled');
    assert.ok(!types.includes('error'), 'не должно быть error');
    assert.strictEqual(history.getRuns()[0].status, 'cancelled');
  });

  test('handleImplementPlan: AbortError → cancelled (не «Ошибка имплементации»)', async () => {
    const abortErr = new Error('Request was aborted');
    abortErr.name = 'AbortError';
    sandbox.stub(PlanModeManager.prototype, 'implementPlan').rejects(abortErr);

    const webview = fakeWebviewView();
    provider['view'] = webview.view;

    const id1 = cm.session.getActive()!.meta.id;
    await provider['handleImplementPlan']('/tmp/plan.md', undefined, undefined, id1);

    const types = webview.messages.map((m) => m?.type);
    assert.ok(types.includes('cancelled'), 'должен быть cancelled');
    assert.ok(!types.includes('error'), 'не должно быть error');
    assert.strictEqual(history.getRuns()[0].status, 'cancelled');
  });

  test('@orchestrate: AbortError → cancelled (не ошибка)', async () => {
    const abortErr = new Error('Request was aborted');
    abortErr.name = 'AbortError';
    sandbox.stub(AgentOrchestrator.prototype, 'execute').rejects(abortErr);

    const webview = fakeWebviewView();
    provider['view'] = webview.view;

    const id1 = cm.session.getActive()!.meta.id;
    await send('@orchestrate сделай модуль', 'agent', false, id1);

    const types = webview.messages.map((m) => m?.type);
    assert.ok(types.includes('cancelled'), 'должен быть cancelled');
    assert.ok(!types.includes('error'), 'не должно быть error');
    assert.strictEqual(history.getRuns()[0].status, 'cancelled');
  });

  test('агент: AbortError из createWithTools → cancelled', async () => {
    mockLLM.createWithTools = sinon.stub().callsFake(async () => {
      const e = new Error('Request was aborted');
      e.name = 'AbortError';
      throw e;
    });

    const webview = fakeWebviewView();
    provider['view'] = webview.view;

    const id1 = cm.session.getActive()!.meta.id;
    await send('сделай задачу', 'agent', false, id1);

    const types = webview.messages.map((m) => m?.type);
    assert.ok(types.includes('cancelled'), 'должен быть cancelled');
    assert.ok(!types.includes('error'), 'не должно быть error');
    assert.strictEqual(history.getRuns()[0].status, 'cancelled');
  });

  // ===== F1: getTranscript + refreshSessionList =====

  test('getTranscript → sessionTranscript с текстом из session-log', async () => {
    const sessionLog = new SessionLog(storage);
    const sid = 'session_transcript_test';
    sessionLog.append({ sessionId: sid, ts: 1, type: 'user/message', content: 'привет' });
    provider = providerWithLog(sessionLog);
    const webview = fakeWebviewView();
    provider['view'] = webview.view;

    await provider['handleWebviewMessage']({ type: 'getTranscript', sessionId: sid, action: 'copy' });

    assert.strictEqual(webview.messages.length, 1, 'postMessage вызван один раз');
    const msg = webview.messages[0];
    assert.strictEqual(msg.type, 'sessionTranscript');
    assert.strictEqual(msg.action, 'copy');
    assert.ok(msg.text.includes(`# Сессия: ${sid}`), 'заголовок транскрипции');
    assert.ok(msg.text.includes('привет'), 'текст события из лога');
  });

  test('refreshSessionList(): шлёт sessionList + history в WebView', () => {
    const webview = fakeWebviewView();
    provider['view'] = webview.view;

    provider['refreshSessionList']();

    const types = webview.messages.map((m) => m.type);
    assert.ok(types.includes('sessionList'), 'sessionList отправлен');
    assert.ok(types.includes('history'), 'history отправлен');
  });

  test('clearAllSessions → executeCommand("llmAssistant.clearAllSessions")', async () => {
    const executeCommand = sandbox.stub(vscode.commands, 'executeCommand').resolves(undefined);

    await provider['handleWebviewMessage']({ type: 'clearAllSessions' });

    assert.ok(executeCommand.calledOnce, 'executeCommand вызван один раз');
    assert.ok(executeCommand.calledWith('llmAssistant.clearAllSessions'), 'с правильным именем команды');
  });

  test('toggleFavorite: переключает избранное и пересылает sessionList', async () => {
    const webview = fakeWebviewView();
    provider['view'] = webview.view;

    const sid = cm.session.getActive()!.meta.id;
    await provider['handleWebviewMessage']({ type: 'toggleFavorite', sessionId: sid });

    assert.strictEqual(cm.session.getActive()!.meta.favorite, true, 'избранное включено');

    const msg = webview.messages.find((m) => m.type === 'sessionList');
    assert.ok(msg, 'sessionList переслан');
    const s = msg.sessions.find((x: any) => x.id === sid);
    assert.strictEqual(s.favorite, true, 'favorite проставлен в sessionList');
  });

  test('sendSessionListToWebview: обогащает сессии превью из session-log', () => {
    const sid = cm.session.getActive()!.meta.id;
    const sessionLog = new SessionLog(storage);
    sessionLog.append({ sessionId: sid, ts: 1, type: 'user/message', content: 'Как написать юнит-тест?' });
    provider = providerWithLog(sessionLog);
    const webview = fakeWebviewView();
    provider['view'] = webview.view;

    provider['sendSessionListToWebview']();

    const msg = webview.messages[0];
    const s = msg.sessions.find((x: any) => x.id === sid);
    assert.ok(s, 'сессия в sessionList');
    assert.strictEqual(s.preview, 'Как написать юнит-тест?', 'превью из последнего сообщения');
  });

  test('sendHistoryToWebview: шлёт items с шагами из session-log (P0-fix)', () => {
    const sid = cm.session.getActive()!.meta.id;
    const sessionLog = new SessionLog(storage);
    sessionLog.append({ sessionId: sid, ts: 1, type: 'user/message', content: 'задача' });
    sessionLog.append({ sessionId: sid, ts: 2, type: 'tool/call', stepId: 's1', name: 'read_file', args: { path: 'a.ts' } });
    sessionLog.append({ sessionId: sid, ts: 3, type: 'tool/result', stepId: 's1', name: 'read_file', result: 'содержимое' });
    sessionLog.append({ sessionId: sid, ts: 4, type: 'assistant/message', content: 'готово' });
    provider = providerWithLog(sessionLog);
    const webview = fakeWebviewView();
    provider['view'] = webview.view;

    provider['sendHistoryToWebview']();

    const msg = webview.messages[0];
    assert.strictEqual(msg.type, 'history');
    const items = msg.messages;
    assert.strictEqual(items.length, 2, 'user + assistant');
    assert.strictEqual(items[0].kind, 'user');
    assert.strictEqual(items[0].content, 'задача');
    assert.strictEqual(items[1].kind, 'assistant');
    assert.strictEqual(items[1].steps.length, 1, '1 шаг в трейсе');
    assert.strictEqual(items[1].steps[0].toolName, 'read_file');
    assert.strictEqual(items[1].steps[0].result, 'содержимое');
  });

  test('markCancelled: персистит «Запрос отменён» в session-log (P0-fix)', () => {
    const webview = fakeWebviewView();
    provider['view'] = webview.view;

    const sid = cm.session.getActive()!.meta.id;
    const sessionLog = new SessionLog(storage);
    // журнал внедряется в ConversationManager (поле не readonly) — сообщение пишется через него
    cm['sessionLog'] = sessionLog;

    provider['markCancelled'](sid);

    const events = sessionLog.getEvents(sid);
    const assistant = events.find((e): e is AssistantMessageEvent => e.type === 'assistant/message');
    assert.ok(assistant, 'маркер отмены в логе');
    assert.strictEqual(assistant.content, '_Запрос отменён._');
  });

  test('getHtmlForWebview: инжектит webview-ресурсы без незаменённых плейсхолдеров (P0-6.1)', () => {
    // Указываем реальный корень репо, чтобы getHtmlForWebview читал настоящие файлы webview
    const realRoot = path.resolve(__dirname, '../../..');
    // тот же объект контекста, что держит провайдер: подменяем корень для чтения ресурсов
    ctxRef.extensionUri = vscode.Uri.file(realRoot);

    const html = provider['getHtmlForWebview']();

    assert.ok(!html.includes('{{'), 'нет незаменённых {{...}}-плейсхолдеров');
    assert.ok(html.includes('TOOLBAR_ACTIONS'), 'toolbar.js инжектирован ({{TOOLBAR}})');
    assert.ok(html.includes('TOOL_ACTIVITY'), 'toolActivity.js инжектирован ({{TOOLACTIVITY}})');
    assert.ok(html.includes('id="session-sidebar"'), 'сайдбар сессий в разметке (P0-2)');
    assert.ok(html.includes('id="input-toolbar"'), 'input-toolbar в разметке (P0-4)');
    assert.ok(html.includes('id="header-actions"'), 'header-actions в разметке (P0-1)');
  });
});

// ─────────── Stage 3 / AC CVP-1.1, CVP-1.2: список провайдеров для WebView ───────────
suite('buildProviderListFromConfig', () => {
  test('CVP-1.1: модели берутся из конфигурации, отсутствие models → пустой список', () => {
    const providers = buildProviderListFromConfig({
      deepseek: { baseUrl: 'https://api.deepseek.com/v1', models: ['deepseek-flash'] },
      empty: { baseUrl: 'http://x' },
    });

    assert.deepStrictEqual(providers.deepseek.models, ['deepseek-flash']);
    assert.deepStrictEqual(providers.empty.models, []);
    assert.strictEqual(providers.deepseek.isLocal, undefined);
  });

  test('CVP-1.2: локальный провайдер помечен isLocal', () => {
    const providers = buildProviderListFromConfig({
      local: { type: 'ollama', baseUrl: 'http://127.0.0.1:11434', models: [] },
      cloud: { type: 'openai', models: ['gpt-4o'] },
    });

    assert.strictEqual(providers.local.isLocal, true);
    assert.strictEqual(providers.cloud.isLocal, undefined);
  });

  test('CVP-3.1: человеческое имя — title побеждает, локальный без title получает «(локально)»', () => {
    const providers = buildProviderListFromConfig({
      'local-llamacpp': { type: 'openai', baseUrl: 'http://127.0.0.1:8080/v1', models: ['qwen3-8b'] },
      local: { type: 'ollama', baseUrl: 'http://127.0.0.1:11434', models: [], title: 'Ollama (локально)' },
      deepseek: { baseUrl: 'https://api.deepseek.com/v1', models: ['deepseek-chat'] },
    });

    assert.strictEqual(providers['local-llamacpp'].title, 'local-llamacpp (локально)', 'локальный openai не должен читаться как облачный');
    assert.strictEqual(providers.local.title, 'Ollama (локально)', 'явный title не перетирается');
    assert.strictEqual(providers.deepseek.title, 'deepseek', 'у облачного имя без суффикса');
  });

  test('CVP-1.1: пустая конфигурация не роняет сборку', () => {
    assert.deepStrictEqual(buildProviderListFromConfig({}), {});
  });
});

// ─────────── CVP-1.5: выбор модели не уезжает другому провайдеру ───────────
suite('resolveModelForProvider', () => {
  test('CVP-1.5: явный выбор пользователя не трогаем', async () => {
    const provider = { models: async () => ['gemma3:4b', 'qwen3:8b'] };
    assert.strictEqual(await resolveModelForProvider(provider, 'qwen3:8b', 'deepseek-flash', 'local'), 'qwen3:8b');
  });

  test('CVP-1.5: пустой выбор + провайдер → первая модель провайдера, а не глобальный default', async () => {
    const provider = { models: async () => ['gemma3:4b'] };
    assert.strictEqual(
      await resolveModelForProvider(provider, '', 'deepseek-ai/DeepSeek-V4-Flash-0731', 'local'),
      'gemma3:4b',
    );
  });

  test('CVP-1.5: провайдер без моделей / discovery упал → глобальный default', async () => {
    assert.strictEqual(await resolveModelForProvider({ models: async () => [] }, '', 'gpt-4o', 'local'), 'gpt-4o');
    const broken = { models: async () => { throw new Error('offline'); } };
    assert.strictEqual(await resolveModelForProvider(broken, '', 'gpt-4o', 'local'), 'gpt-4o');
    assert.strictEqual(await resolveModelForProvider(undefined, '', 'gpt-4o', undefined), 'gpt-4o');
  });
});

// ─────────── CVP-1.6: vision-поддержка модели ───────────
suite('resolveVisionSupport', () => {
  test('CVP-1.6: явный supportsVision в конфиге — приоритет, capabilities не спрашиваем', async () => {
    const provider = { supportsVision: true, isLocal: true, capabilities: async () => ({ vision: false }) };
    assert.strictEqual(await resolveVisionSupport(provider, 'gemma3:4b'), true);
  });

  test('CVP-1.6: локальный провайдер без флага — решает capability vision', async () => {
    const yes = { isLocal: true, capabilities: async () => ({ vision: true }) };
    const no = { isLocal: true, capabilities: async () => ({ vision: false }) };
    assert.strictEqual(await resolveVisionSupport(yes, 'gemma3:4b'), true);
    assert.strictEqual(await resolveVisionSupport(no, 'qwen3:8b'), false);
  });

  test('CVP-1.6: облачный провайдер без supportsVision или ошибка capabilities → false', async () => {
    assert.strictEqual(await resolveVisionSupport({ supportsVision: false }, 'deepseek-chat'), false);
    const broken = { isLocal: true, capabilities: async () => { throw new Error('offline'); } };
    assert.strictEqual(await resolveVisionSupport(broken, 'gemma3:4b'), false);
  });
});

// ─────────── CVP-1.7: картинка не уходит молча ───────────
suite('visionUnsupportedWarning', () => {
  test('CVP-1.7: предупреждение называет модель и подсказывает vision-модель', () => {
    const text = visionUnsupportedWarning('qwen3:8b');
    assert.match(text, /qwen3:8b/);
    assert.match(text, /не поддерживает изображения/);
    assert.match(text, /gemma3:4b/);
  });
});

// ─────────── CVP-1.8: «Открыть чат» ставит курсор в поле ввода ───────────
suite('ChatViewProvider / reveal (chat.open)', () => {
  test('CVP-1.8: reveal() раскрывает панель и посылает focusInput', () => {
    const postMessage = sinon.stub();
    const show = sinon.stub();
    const webview = fakeWebviewView();
    webview.view.show = show;

    // Экземпляр без конструктора: reveal() не трогает остальные поля провайдера
    const provider: ChatViewProvider = Object.create(ChatViewProvider.prototype);
    provider['view'] = webview.view;
    provider['postMessage'] = (m) => postMessage(m);

    provider.reveal();

    assert.strictEqual(show.calledOnce, true, 'панель раскрыта');
    const types = postMessage.getCalls().map((c) => c.args[0]?.type);
    assert.ok(types.includes('focusInput'), `ожидали focusInput, факт: ${JSON.stringify(types)}`);
  });
});
