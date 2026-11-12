// E2E: Plan Mode — сессионная привязка результата.
// Сценарий ручного теста: план в сессии A → переключение чатов → очистка истории →
// имплементация → результат должен остаться в A (не в текущем чате) и не потеряться.

import 'mocha';
import * as assert from 'assert';
import * as sinon from 'sinon';
import * as vscode from 'vscode';
import { ChatViewProvider } from '../../../src/modes/chat/ChatViewProvider';
import { ConversationManager } from '../../../src/modes/chat/ConversationManager';
import { RunHistoryStore } from '../../../src/shared/RunHistoryStore';
import { PlanModeManager } from '../../../src/modes/chat/PlanModeManager';
import { MultiAgentResult } from '../../../src/modes/apply/AgentOrchestrator';
import { fakeConfiguration, fakeOutputChannel } from '../../support/vscode-harness';

/**
 * Приватные методы ChatViewProvider: публичного API для них нет, e2e дёргает их напрямую.
 * Сигнатуры повторяют src — при расхождении сборка тестов упадёт.
 */
interface ChatProviderInternals {
  handlePlanMode(text: string, provider: unknown, model: string, sessionId?: string, signal?: AbortSignal): Promise<void>;
  handleImplementPlan(planPath: string, providerName?: string, modelName?: string, sessionId?: string): Promise<void>;
}

/** Результат оркестратора-stage: минимальный, но полный по интерфейсу. */
function orchestratorResult(): MultiAgentResult {
  return {
    taskId: 'impl_1',
    strategy: 'sequential',
    workers: [
      {
        roleName: 'coder',
        result: { answer: 'готово', steps: [], iterations: 1, inputTokens: 0, outputTokens: 0, cost: 0 },
      },
    ],
    totalInputTokens: 0,
    totalOutputTokens: 0,
    totalCost: 0,
    costPerWorker: { coder: 0 },
    success: true,
    summary: 'имплементация завершена',
  };
}

suite('E2E: Plan Mode — сессионная привязка', () => {
  let sandbox: sinon.SinonSandbox;
  let cm: ConversationManager;
  let history: RunHistoryStore;
  let provider: ChatViewProvider;

  setup(() => {
    sandbox = sinon.createSandbox();

    // Реальный vscode (workspace/workspaceFolders), но стабы конфигурации и output channel
    sandbox.stub(vscode.workspace, 'getConfiguration').returns(
      fakeConfiguration((key, def) => {
        if (key === 'chat.maxContextTokens') return 4096;
        if (key === 'chat.summaryEnabled') return false;
        if (key === 'defaultProvider') return 'test';
        if (key === 'defaultModel') return 'test-model';
        return def;
      }),
    );
    sandbox.stub(vscode.window, 'createOutputChannel').returns(fakeOutputChannel());

    // In-memory хранилища (get возвращает дефолт — иначе SessionManager.load падает на Object.entries(undefined))
    const storage: vscode.Memento = {
      get: <T>(_key: string, def?: T) => def as T,
      update: async () => undefined,
      keys: () => [],
    };
    const globalState: vscode.Memento = (() => {
      let stored: unknown = [];
      return {
        get: <T>(_key: string, def?: T) => (stored === undefined ? (def as T) : (stored as T)),
        update: async (_key: string, value: unknown) => {
          stored = Array.isArray(value) ? [...value] : value;
        },
        keys: () => [],
      };
    })();

    cm = new ConversationManager(storage);
    history = new RunHistoryStore(globalState);

    const mockLLM: any = { chat: () => (async function* () {})(), createWithTools: undefined };
    const pm: any = { getProvider: () => mockLLM, getDefault: () => mockLLM, pricingMap: new Map(), refresh: () => {} };

    const ctx: any = {
      subscriptions: { push: () => {} },
      extensionUri: vscode.Uri.file('/tmp'),
      workspaceState: storage,
      globalState: globalState,
      extensionPath: '/tmp',
      asAbsolutePath: (p: string) => p,
    };

    provider = new ChatViewProvider(ctx, pm, cm, history, undefined, undefined);
  });

  teardown(() => sandbox.restore());

  test('план в A → переключение на B → очистка → имплементация: результат только в A', async () => {
    const idA = cm.session.getActive()!.meta.id;
    const idB = cm.session.createSession('Вторая'); // B становится активной

    // 1. Генерация плана в A (явно передаём sessionId=A, хотя активная — B)
    sandbox.stub(PlanModeManager.prototype, 'generatePlan').resolves({ planPath: '/tmp/plan.md', content: '# План', planId: 'abc' });
    const internals = provider as unknown as ChatProviderInternals;
    await internals.handlePlanMode('составь план', {}, 'test-model', idA);

    // План персистился в A
    cm.session.switchTo(idA);
    assert.ok(cm.getMessages().some((m: any) => m.content.includes('# План')), 'план сохранён в A');

    // 2. Переключаемся на B и очищаем историю (как в сценарии пользователя)
    cm.session.switchTo(idB);
    cm.clearHistory();          // очистить активную (B)
    history.clearHistory();     // очистить run-историю

    // 3. Имплементация в A (исходная сессия)
    sandbox.stub(PlanModeManager.prototype, 'implementPlan').resolves({ orchestratorResult: orchestratorResult() });
    sandbox.stub(PlanModeManager.prototype, 'reflect').resolves({
      report: 'AC-1 ✅ пройден', allPassed: true, cycles: 1, summary: 'готово',
    });
    await internals.handleImplementPlan('/tmp/plan.md', undefined, undefined, idA);

    // 4. Результат в A, B пуст
    cm.session.switchTo(idA);
    const msgsA = cm.getMessages();
    assert.ok(msgsA.some((m: any) => m.content.includes('Имплементация завершена')), 'имплементация в A');
    assert.ok(msgsA.some((m: any) => m.content.includes('Рефлексия')), 'рефлексия в A');

    cm.session.switchTo(idB);
    assert.strictEqual(cm.getMessages().length, 0, 'B пуст — результат не утёк в текущий чат');

    // 5. История: запись в исходной сессии A
    const runs = history.getRuns();
    assert.ok(runs.length >= 1, 'есть запись в истории');
    assert.strictEqual(runs[0].sessionId, idA, 'запись привязана к исходной сессии A');
  });
});
