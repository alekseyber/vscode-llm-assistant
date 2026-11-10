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

  test('регистрирует все 14 команд', () => {
    registerCommands(makeDeps());

    const names = registerSpy.getCalls().map((c) => c.args[0]);
    assert.deepStrictEqual(names.sort(), [
      'llmAssistant.apply.start',
      'llmAssistant.autocomplete.toggle',
      'llmAssistant.chat.addSelection',
      'llmAssistant.chat.open',
      'llmAssistant.checkLocalServer',
      'llmAssistant.clearAllSessions',
      'llmAssistant.edit.selection',
      'llmAssistant.exportSession',
      'llmAssistant.forkSession',
      'llmAssistant.openHistory',
      'llmAssistant.resetDailyBudget',
      'llmAssistant.review.file',
      'llmAssistant.selectProvider',
      'llmAssistant.showRulesSources',
    ].sort());
    assert.strictEqual(registerSpy.callCount, 14);
  });

  test('все команды добавляются в context.subscriptions', () => {
    const deps = makeDeps();
    registerCommands(deps);

    // 14 команд + один общий канал «Правила» (создаётся один раз) = 15 подписок
    assert.strictEqual(deps.context.subscriptions.push.callCount, 15);
  });

  test('chat.open: reveal контейнера + revealChat (вместо легаси ChatPanel)', async () => {
    const deps = makeDeps();
    deps.revealChat = sandbox.stub();
    const executeCommand = sandbox.stub(vscode.commands, 'executeCommand').resolves(undefined);
    registerCommands(deps);

    const handler = registerSpy.getCalls().find(c => c.args[0] === 'llmAssistant.chat.open')?.args[1];
    assert.ok(handler, 'chat.focus зарегистрирован');
    await handler();

    assert.ok(executeCommand.calledWith('workbench.view.extension.llmAssistant'), 'показывает контейнер сайдбара');
    assert.ok(deps.revealChat.calledOnce, 'revealChat вызван (фокус вкладки чата)');
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

  test('openHistory фокусирует Историю, а не Чат (P15)', async () => {
    const deps = makeDeps();
    const executeCommand = sandbox.stub(vscode.commands, 'executeCommand').resolves(undefined);
    registerCommands(deps);

    const handler = registerSpy.getCalls().find(c => c.args[0] === 'llmAssistant.openHistory')?.args[1];
    assert.ok(handler, 'openHistory зарегистрирован');
    await handler();

    assert.ok(executeCommand.calledWith('llmAssistant.history.focus'), 'фокусируется вкладка История');
    assert.ok(!executeCommand.calledWith('llmAssistant.chat.open'), 'Чат не фокусируется');
  });
});

// ─────────── Идентификаторы команд не конфликтуют с авто-командами VS Code ───────────
suite('package.json / id команд и view', () => {
  test('CMD-1: ни одна наша команда не совпадает с <viewId>.focus', () => {
    const pkg = require('../../../package.json');
    const views = Object.values(pkg.contributes.views ?? {}).flat() as any[];
    const viewIds = views.map((v) => v.id);
    const reserved = viewIds.map((id) => `${id}.focus`);

    const ours = pkg.contributes.commands.map((c: any) => c.command);
    const clashes = ours.filter((id: string) => reserved.includes(id));
    assert.deepStrictEqual(clashes, [], `конфликт с авто-командой VS Code: ${JSON.stringify(clashes)}`);

    // «Открыть чат» должен существовать под своим id (иначе палитра показывает только «Focus on Чат View»)
    assert.ok(ours.includes('llmAssistant.chat.open'), 'llmAssistant.chat.open объявлен');
  });
});

// ─────────── Манифест и код не должны расходиться ───────────
suite('package.json ↔ registerCommands', () => {
  let sb: any;
  let spy: any;

  setup(() => {
    sb = sinon.createSandbox();
    spy = sb.spy(vscode.commands, 'registerCommand');
  });
  teardown(() => sb.restore());

  function deps(): any {
    const context: any = {
      subscriptions: { push: sb.stub() },
      extensionUri: vscode.Uri.file('/tmp'),
      workspaceState: {},
      globalState: {},
    };
    return {
      context,
      providerManager: { getAllProviders: () => new Map(), getDefault: () => undefined },
      conversationManager: {
        attachCodeContext: sb.stub(),
        clearAll: sb.stub(),
        session: {
          getActive: sb.stub().returns({ meta: { id: 'session_default' } }),
          duplicateSession: sb.stub().returns('session_fork_default'),
          listSessions: sb.stub().returns([{ id: 'a' }]),
        },
      },
      editController: { handleEditSelection: sb.stub() },
      autocompleteController: { toggleAutocomplete: sb.stub() },
      runHistoryStore: { recordRun: sb.stub(), clearHistory: sb.stub() },
      historyViewProvider: { refresh: sb.stub() },
      reviewViewProvider: { showReview: sb.stub() },
      sessionLog: { toTranscript: sb.stub().returns(''), fork: sb.stub(), computeStats: sb.stub().returns({ steps: 0, toolCalls: 0, toolResults: 0, errors: 0, userMessages: 0, assistantMessages: 0, chunks: 0 }) },
      refreshSessions: sb.stub(),
    };
  }

  test('CMD-2: каждая объявленная команда регистрируется в коде', () => {
    const pkg = require('../../../package.json');
    const declared: string[] = pkg.contributes.commands.map((c: any) => c.command);

    registerCommands(deps());
    const registered: string[] = spy.getCalls().map((c: any) => c.args[0]);

    const missing = declared.filter((id) => !registered.includes(id));
    assert.deepStrictEqual(missing, [], `объявлены в package.json, но не регистрируются: ${JSON.stringify(missing)}`);

    const extra = registered.filter((id) => !declared.includes(id));
    assert.deepStrictEqual(extra, [], `регистрируются, но не объявлены (не будет в палитре): ${JSON.stringify(extra)}`);
  });

  test('CMD-3: непустые уникальные заголовки, keybindings ведут на существующие команды', () => {
    const pkg = require('../../../package.json');
    const titles: string[] = pkg.contributes.commands.map((c: any) => c.title);
    assert.ok(titles.every((x) => typeof x === 'string' && x.trim().length > 0), 'пустой заголовок');
    assert.strictEqual(new Set(titles).size, titles.length, 'дубли заголовков в палитре');

    const kbs = pkg.contributes.keybindings ?? [];
    const bad = kbs.filter((k: any) => !pkg.contributes.commands.some((c: any) => c.command === k.command));
    assert.deepStrictEqual(bad, [], `keybinding на несуществующую команду: ${JSON.stringify(bad)}`);
  });

  test('CMD-4: объявленные команды не скрыты из палитры через menus.commandPalette', () => {
    const pkg = require('../../../package.json');
    const hidden = (pkg.contributes.menus?.commandPalette ?? []).filter((m: any) => m.when === 'false');
    assert.deepStrictEqual(hidden, [], `скрыто из палитры: ${JSON.stringify(hidden)}`);
  });
});
