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

suite('E2E: Plan Mode — сессионная привязка', () => {
  let sandbox: sinon.SinonSandbox;
  let cm: ConversationManager;
  let history: RunHistoryStore;
  let provider: ChatViewProvider;

  setup(() => {
    sandbox = sinon.createSandbox();

    // Реальный vscode (workspace/workspaceFolders), но стабы конфигурации и output channel
    const config = {
      get: (key: string, def?: unknown) => {
        if (key === 'chat.maxContextTokens') return 4096;
        if (key === 'chat.summaryEnabled') return false;
        if (key === 'defaultProvider') return 'test';
        if (key === 'defaultModel') return 'test-model';
        return def;
      },
      has: () => false,
      inspect: () => undefined,
      update: () => Promise.resolve(),
    };
    sandbox.stub(vscode.workspace, 'getConfiguration').returns(config as any);
    sandbox.stub(vscode.window, 'createOutputChannel').returns({
      appendLine: () => {}, append: () => {}, show: () => {}, hide: () => {}, clear: () => {}, dispose: () => {},
    } as any);

    // In-memory хранилища
    const storage = { get: () => undefined, update: () => Promise.resolve(), keys: () => [], setKeysForSync: () => {} };
    const globalState = (() => {
      let runs: any[] = [];
      return {
        get: () => runs,
        update: (_k: string, v: any) => { runs = Array.isArray(v) ? [...v] : v; return Promise.resolve(); },
        keys: () => [],
        setKeysForSync: () => {},
      };
    })();

    cm = new ConversationManager(storage as any);
    history = new RunHistoryStore(globalState as any);

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
    await (provider as any).handlePlanMode('составь план', {} as any, 'test-model', idA);

    // План персистился в A
    cm.session.switchTo(idA);
    assert.ok(cm.getMessages().some((m: any) => m.content.includes('# План')), 'план сохранён в A');

    // 2. Переключаемся на B и очищаем историю (как в сценарии пользователя)
    cm.session.switchTo(idB);
    cm.clearHistory();          // очистить активную (B)
    history.clearHistory();     // очистить run-историю

    // 3. Имплементация в A (исходная сессия)
    sandbox.stub(PlanModeManager.prototype, 'implementPlan').resolves({
      orchestratorResult: { workers: [{ roleName: 'coder' }] },
    } as any);
    sandbox.stub(PlanModeManager.prototype, 'reflect').resolves({
      report: 'AC-1 ✅ пройден', allPassed: true, cycles: 1, summary: 'готово',
    } as any);
    await (provider as any).handleImplementPlan('/tmp/plan.md', undefined, undefined, idA);

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
