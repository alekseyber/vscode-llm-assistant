// Тесты registerCommands — централизованная регистрация 7 команд расширения

import 'mocha';
import * as sinon from 'sinon';
import * as vscode from 'vscode';
import * as assert from 'assert';
import { registerCommands } from '../../src/activation/registerCommands';

suite('registerCommands', () => {
  let sandbox: sinon.SinonSandbox;
  let registerSpy: sinon.SinonSpy;

  setup(() => {
    sandbox = sinon.createSandbox();
    registerSpy = sandbox.spy(vscode.commands, 'registerCommand');
  });

  teardown(() => sandbox.restore());

  function makeDeps(): any {
    const context: any = {
      subscriptions: { push: sandbox.stub() },
      extensionUri: vscode.Uri.file('/tmp'),
      workspaceState: {},
      globalState: {},
    };
    return {
      context,
      providerManager: { getAllProviders: () => new Map(), getDefault: () => undefined },
      conversationManager: {
        attachCodeContext: sandbox.stub(),
        clearAll: sandbox.stub(),
        session: {
          getActive: sandbox.stub().returns({ meta: { id: 'session_default' } }),
          duplicateSession: sandbox.stub().returns('session_fork_default'),
          listSessions: sandbox.stub().returns([{ id: 'a' }, { id: 'b' }]),
        },
      },
      editController: { handleEditSelection: sandbox.stub() },
      autocompleteController: { toggleAutocomplete: sandbox.stub() },
      runHistoryStore: { recordRun: sandbox.stub(), clearHistory: sandbox.stub() },
      historyViewProvider: { refresh: sandbox.stub() },
      reviewViewProvider: { showReview: sandbox.stub() },
      sessionLog: { toTranscript: sandbox.stub().returns(''), fork: sandbox.stub(), computeStats: sandbox.stub().returns({ steps: 0, toolCalls: 0, toolResults: 0, errors: 0, userMessages: 0, assistantMessages: 0, chunks: 0 }) },
      refreshSessions: sandbox.stub(),
    };
  }

  test('регистрирует все 11 команд', () => {
    registerCommands(makeDeps());

    const names = registerSpy.getCalls().map((c) => c.args[0]);
    assert.deepStrictEqual(names.sort(), [
      'llmAssistant.apply.start',
      'llmAssistant.autocomplete.toggle',
      'llmAssistant.chat.addSelection',
      'llmAssistant.chat.focus',
      'llmAssistant.clearAllSessions',
      'llmAssistant.edit.selection',
      'llmAssistant.exportSession',
      'llmAssistant.forkSession',
      'llmAssistant.openHistory',
      'llmAssistant.review.file',
      'llmAssistant.selectProvider',
    ].sort());
    assert.strictEqual(registerSpy.callCount, 11);
  });

  test('все команды добавляются в context.subscriptions', () => {
    const deps = makeDeps();
    registerCommands(deps);

    // 11 команд регистрируются через context.subscriptions.push
    assert.strictEqual(deps.context.subscriptions.push.callCount, 11);
  });

  test('forkSession: duplicateSession + fork + refreshSessions', async () => {
    const deps = makeDeps();
    registerCommands(deps);

    const handler = registerSpy.getCalls().find(c => c.args[0] === 'llmAssistant.forkSession')?.args[1];
    assert.ok(handler, 'forkSession зарегистрирован');
    await handler();

    assert.ok(deps.conversationManager.session.duplicateSession.calledWith('session_default', 0), 'дублирует активную сессию (с messageCount из лога)');
    assert.ok(deps.sessionLog.fork.calledWith('session_default', 'session_fork_default'), 'fork лога с тем же id');
    assert.ok(deps.refreshSessions.calledOnce, 'refresh вызван после fork');
  });

  test('clearAllSessions: подтверждение → clearAll + refresh', async () => {
    const deps = makeDeps();
    registerCommands(deps);
    sandbox.stub(vscode.window, 'showWarningMessage').resolves('Удалить всё' as any);

    const handler = registerSpy.getCalls().find(c => c.args[0] === 'llmAssistant.clearAllSessions')?.args[1];
    assert.ok(handler, 'clearAllSessions зарегистрирован');
    await handler();

    assert.ok(deps.conversationManager.clearAll.calledOnce, 'clearAll вызван');
    assert.ok(deps.runHistoryStore.clearHistory.calledOnce, 'история запусков очищена');
    assert.ok(deps.refreshSessions.calledOnce, 'refresh вызван');
  });

  test('clearAllSessions: отмена не вызывает clearAll', async () => {
    const deps = makeDeps();
    registerCommands(deps);
    sandbox.stub(vscode.window, 'showWarningMessage').resolves(undefined as any);

    const handler = registerSpy.getCalls().find(c => c.args[0] === 'llmAssistant.clearAllSessions')?.args[1];
    await handler();

    assert.ok(!deps.conversationManager.clearAll.called, 'clearAll не вызван при отмене');
  });

  test('exportSession: toTranscript → showSaveDialog → writeFile', async () => {
    const deps = makeDeps();
    deps.sessionLog.toTranscript = sandbox.stub().returns('# Сессия\nпривет');
    const uri = vscode.Uri.file('/fake/workspace/session-default.md');
    sandbox.stub(vscode.window, 'showSaveDialog').resolves(uri);
    const writeFile = sandbox.stub(vscode.workspace.fs, 'writeFile').resolves();
    registerCommands(deps);

    const handler = registerSpy.getCalls().find(c => c.args[0] === 'llmAssistant.exportSession')?.args[1];
    assert.ok(handler, 'exportSession зарегистрирован');
    await handler();

    assert.ok(deps.sessionLog.toTranscript.calledWith('session_default'), 'toTranscript вызван для активной сессии');
    assert.ok(writeFile.calledOnce, 'writeFile вызван один раз');
    assert.ok(writeFile.getCall(0).args[1].toString().includes('привет'), 'файл содержит транскрипцию');
  });
});
