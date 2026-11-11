// Тесты двух поверхностей, у которых не было ни одного теста:
//   ProposalContentProvider (36 строк) — виртуальные документы для diff-предпросмотра;
//   ReviewPanel (174 строки) — широкое окно отчёта ревью.
//
// Проверяется контракт, который можно проверить без реального WebView: выдача текста по URI,
// событие изменения, сборка HTML, singleton-поведение панели и доставка отчёта после 'ready'.

import 'mocha';
import * as assert from 'assert';
import * as vscode from 'vscode';
import { ProposalContentProvider, PROPOSAL_SCHEME } from '../../src/modes/edit/ProposalContentProvider';
import { ReviewPanel } from '../../src/modes/review/ReviewPanel';

type PanelMock = {
  webview: { html: string; postMessage: (message: any) => Promise<boolean> };
  messages: any[];
  revealed: number;
  disposed: boolean;
  __sendMessage: (message: any) => void;
};

const panels = () => (vscode.workspace as any).__webviewPanels as PanelMock[];
const lastPanel = () => panels()[panels().length - 1];

function makeContext(): vscode.ExtensionContext {
  return new (vscode as any).ExtensionContext();
}

suite('ProposalContentProvider', () => {
  test('PC-1: текст «после» отдаётся по URI, после delete — пусто', () => {
    const provider = new ProposalContentProvider();
    const uri = vscode.Uri.parse('llma-proposal:/proposal/1/after');
    assert.strictEqual(PROPOSAL_SCHEME, 'llma-proposal', 'схема виртуальных документов');

    provider.set(uri, 'const after = 1;');
    assert.strictEqual(provider.provideTextDocumentContent(uri), 'const after = 1;');

    provider.delete(uri);
    assert.strictEqual(provider.provideTextDocumentContent(uri), '', 'после удаления текста нет');
  });

  test('PC-2: два URI не смешиваются', () => {
    const provider = new ProposalContentProvider();
    const before = vscode.Uri.parse('llma-proposal:/proposal/1/before');
    const after = vscode.Uri.parse('llma-proposal:/proposal/1/after');
    provider.set(before, 'old');
    provider.set(after, 'new');
    assert.strictEqual(provider.provideTextDocumentContent(before), 'old');
    assert.strictEqual(provider.provideTextDocumentContent(after), 'new');
  });

  test('PC-3: set сообщает об изменении документа', () => {
    const provider = new ProposalContentProvider();
    const uri = vscode.Uri.parse('llma-proposal:/proposal/2/after');
    const changed: string[] = [];
    provider.onDidChange((changedUri) => changed.push(changedUri.toString()));
    provider.set(uri, 'x');
    assert.deepStrictEqual(changed, [uri.toString()], 'событие изменило ровно этот URI');
  });
});

suite('ReviewPanel', () => {
  setup(() => {
    ReviewPanel.currentPanel = undefined;
    panels().length = 0;
  });

  test('RP-1: createOrShow открывает панель с HTML и заголовком', () => {
    const before = panels().length;
    ReviewPanel.createOrShow(makeContext(), 'src/a.ts', '# Отчёт', 0.01);
    assert.strictEqual(panels().length, before + 1, 'панель создана');
    const panel = lastPanel() as any;
    assert.ok(panel.webview.html.includes('Ревью'), 'в HTML есть заголовок окна');
    assert.ok(panel.webview.html.includes('showReview'), 'в HTML есть обработчик сообщения showReview');
    assert.strictEqual(panel.disposed, false);
  });

  test('RP-2: повторный вызов переиспользует панель, а не создаёт новую', () => {
    const context = makeContext();
    ReviewPanel.createOrShow(context, 'src/a.ts', 'первый', 0.01);
    const created = panels().length;
    ReviewPanel.createOrShow(context, 'src/b.ts', 'второй', 0.02);
    assert.strictEqual(panels().length, created, 'вторая панель не создана');
    assert.strictEqual(lastPanel().revealed, 1, 'существующая панель показана');
  });

  test('RP-3: отчёт уходит в WebView после готовности', () => {
    ReviewPanel.createOrShow(makeContext(), 'src/a.ts', '# Отчёт ревью', 0.0123);
    const panel = lastPanel();
    panel.__sendMessage({ type: 'ready' });
    const report = panel.messages.find((m) => m.type === 'showReview');
    assert.ok(report, 'сообщение showReview отправлено');
    assert.strictEqual(report.filePath, 'src/a.ts');
    assert.strictEqual(report.report, '# Отчёт ревью');
    assert.strictEqual(report.cost, 0.0123, 'стоимость передана без округления');
  });

  test('RP-4: после dispose панель создаётся заново', () => {
    ReviewPanel.createOrShow(makeContext(), 'src/a.ts', 'первый', 0);
    const first = lastPanel() as any;
    // Закрытие панели как в редакторе: dispose панели дёргает onDidDispose расширения
    first.dispose();
    assert.strictEqual(ReviewPanel.currentPanel, undefined, 'расширение забыло закрытую панель');
    const before = panels().length;
    ReviewPanel.createOrShow(makeContext(), 'src/b.ts', 'второй', 0);
    assert.strictEqual(panels().length, before + 1, 'новая панель создана после закрытия');
  });
});
