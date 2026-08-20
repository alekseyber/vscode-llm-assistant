// Тесты обработчика команды review.file (reviewActiveFile): ветки редактора/провайдера/выделения

import 'mocha';
import * as assert from 'assert';
import * as sinon from 'sinon';
import * as vscode from 'vscode';
import { reviewActiveFile } from '../../src/activation/registerCommands';
import { CodeReviewer } from '../../src/modes/review/CodeReviewer';

suite('reviewActiveFile (команда review.file)', () => {
  let sandbox: sinon.SinonSandbox;
  let reviewViewProvider: any;

  setup(() => {
    sandbox = sinon.createSandbox();
    reviewViewProvider = { showReview: sandbox.stub() };
  });

  teardown(() => {
    sandbox.restore();
    (vscode.window as any).activeTextEditor = undefined;
  });

  function makeEditor(selectedText: string, fullText: string): any {
    return {
      selection: {
        isEmpty: selectedText.length === 0,
        start: { line: 0 },
        end: { line: 0 },
      },
      document: {
        uri: { fsPath: '/tmp/a.ts' },
        languageId: 'typescript',
        getText: (sel?: any) => (sel ? selectedText : fullText),
      },
    };
  }

  function makeProviderManager(provider: any): any {
    return { getDefault: () => provider };
  }

  test('нет редактора → warning, showReview не вызывается', async () => {
    (vscode.window as any).activeTextEditor = undefined;
    const warn = sandbox.stub(vscode.window, 'showWarningMessage').resolves();

    await reviewActiveFile(makeProviderManager({ createWithTools: () => {} }), reviewViewProvider);

    assert.ok(warn.calledOnce, 'warning показан');
    assert.ok(reviewViewProvider.showReview.notCalled, 'ревью не запускалось');
  });

  test('провайдер без createWithTools → error', async () => {
    (vscode.window as any).activeTextEditor = makeEditor('', 'const x = 1');
    const err = sandbox.stub(vscode.window, 'showErrorMessage').resolves();

    await reviewActiveFile(makeProviderManager({}), reviewViewProvider);

    assert.ok(err.calledOnce, 'error показан');
    assert.ok(reviewViewProvider.showReview.notCalled);
  });

  test('выделение → reviewCode, весь файл → reviewFile', async () => {
    const reviewCodeStub = sandbox.stub(CodeReviewer.prototype, 'reviewCode').resolves({ report: 'r', iterations: 1, cost: 0 });

    // Выделение есть → reviewCode
    (vscode.window as any).activeTextEditor = makeEditor('const y = 2', 'const y = 2');
    await reviewActiveFile(makeProviderManager({ createWithTools: () => {} }), reviewViewProvider);
    assert.ok(reviewCodeStub.calledOnce, 'reviewCode вызван для выделения');

    // Выделения нет → reviewFile
    const reviewFileStub = sandbox.stub(CodeReviewer.prototype, 'reviewFile').resolves({ report: 'r', iterations: 1, cost: 0 });
    (vscode.window as any).activeTextEditor = makeEditor('', 'const z = 3');
    await reviewActiveFile(makeProviderManager({ createWithTools: () => {} }), reviewViewProvider);
    assert.ok(reviewFileStub.calledOnce, 'reviewFile вызван для всего файла');
  });

  test('результат → showReview с отчётом и стоимостью', async () => {
    (vscode.window as any).activeTextEditor = makeEditor('', 'const x = 1');
    sandbox.stub(CodeReviewer.prototype, 'reviewFile').resolves({ report: '# Отчёт', iterations: 2, cost: 0.0002 });

    await reviewActiveFile(makeProviderManager({ createWithTools: () => {} }), reviewViewProvider);

    assert.ok(reviewViewProvider.showReview.calledOnce, 'showReview вызван');
    const [filePath, report, cost] = reviewViewProvider.showReview.firstCall.args;
    assert.strictEqual(filePath, '/tmp/a.ts');
    assert.strictEqual(report, '# Отчёт');
    assert.strictEqual(cost, 0.0002);
  });
});
