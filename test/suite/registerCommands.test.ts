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
      conversationManager: { attachCodeContext: sandbox.stub() },
      editController: { handleEditSelection: sandbox.stub() },
      autocompleteController: { toggleAutocomplete: sandbox.stub() },
      runHistoryStore: { recordRun: sandbox.stub() },
      historyViewProvider: { refresh: sandbox.stub() },
      reviewViewProvider: { showReview: sandbox.stub() },
      sessionLog: { toTranscript: sandbox.stub().returns(''), fork: sandbox.stub() },
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
});
