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
        session: {
          getActive: sandbox.stub().returns({ meta: { id: 'session_default' } }),
          duplicateSession: sandbox.stub().returns('session_fork_default'),
        },
      },
      editController: { handleEditSelection: sandbox.stub() },
      autocompleteController: { toggleAutocomplete: sandbox.stub() },
      runHistoryStore: { recordRun: sandbox.stub() },
      historyViewProvider: { refresh: sandbox.stub() },
      reviewViewProvider: { showReview: sandbox.stub() },
      sessionLog: { toTranscript: sandbox.stub().returns(''), fork: sandbox.stub() },
      refreshSessions: sandbox.stub(),
    };
  }

  test('регистрирует все 10 команд', () => {
    registerCommands(makeDeps());

    const names = registerSpy.getCalls().map((c) => c.args[0]);
    assert.deepStrictEqual(names.sort(), [
      'llmAssistant.apply.start',
      'llmAssistant.autocomplete.toggle',
      'llmAssistant.chat.addSelection',
      'llmAssistant.chat.focus',
      'llmAssistant.edit.selection',
      'llmAssistant.exportSession',
      'llmAssistant.forkSession',
      'llmAssistant.openHistory',
      'llmAssistant.review.file',
      'llmAssistant.selectProvider',
    ].sort());
    assert.strictEqual(registerSpy.callCount, 10);
  });

  test('все команды добавляются в context.subscriptions', () => {
    const deps = makeDeps();
    registerCommands(deps);

    // 10 команд регистрируются через context.subscriptions.push
    assert.strictEqual(deps.context.subscriptions.push.callCount, 10);
  });

  test('forkSession: duplicateSession + fork + refreshSessions', async () => {
    const deps = makeDeps();
    registerCommands(deps);

    const handler = registerSpy.getCalls().find(c => c.args[0] === 'llmAssistant.forkSession')?.args[1];
    assert.ok(handler, 'forkSession зарегистрирован');
    await handler();

    assert.ok(deps.conversationManager.session.duplicateSession.calledWith('session_default'), 'дублирует активную сессию');
    assert.ok(deps.sessionLog.fork.calledWith('session_default', 'session_fork_default'), 'fork лога с тем же id');
    assert.ok(deps.refreshSessions.calledOnce, 'refresh вызван после fork');
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
