// E2E-25: панель истории на живой панели — селектор статуса и настоящий модуль фильтра.
//
// Почему e2e: скрипты webview в Extension Host не исполняются, поэтому проверить поведение
// селектора здесь нельзя. Проверяется то, что ломается тихо и до пользователя:
//   1) в разметке есть селектор статуса;
//   2) в разметку вставлен НАСТОЯЩИЙ модуль фильтра, а не заглушка-деградация;
//   3) путь к `media/history-filters.js` разрешается из собранного расширения.
// Если файл не попадёт в пакет, фильтр молча отключится — панель отрисуется, фильтра не будет.

import 'mocha';
import * as assert from 'assert';
import * as vscode from 'vscode';
import { HistoryViewProvider } from '../../../src/modes/history/HistoryViewProvider';
import { RunHistoryStore } from '../../../src/shared/RunHistoryStore';
import { createFakeWebviewView } from './helpers/webview';
import { fakeCancellationToken } from '../../support/vscode-harness';
import { fakeMemento } from '../../support/fakes';

function renderHtml(): string {
  const provider = new HistoryViewProvider(new RunHistoryStore(fakeMemento()), vscode.Uri.file('/missing-ext'));
  const view = createFakeWebviewView();
  provider.resolveWebviewView(view, { state: undefined }, fakeCancellationToken());
  return view.webview.html as string;
}

suite('E2E-25: панель истории — фильтр по статусу', () => {
  test('25a: в разметке есть селектор статуса со всеми статусами прогона', () => {
    const html = renderHtml();
    assert.ok(html.includes('id="status-filter"'), 'селектор статуса отсутствует');
    for (const status of ['success', 'error', 'cancelled', 'limit_exceeded', 'running']) {
      assert.ok(html.includes(`value="${status}"`), `нет варианта статуса ${status}`);
    }
    assert.ok(html.includes('id="mode-filter"'), 'фильтр режима пропал');
  });

  test('25b: вставлен настоящий модуль фильтра, а не заглушка деградации', () => {
    const html = renderHtml();
    // В модуле экспорт идёт сокращённой записью `{ filterRuns, emptyStateText, filterSuffix }`,
    // поэтому ищем объявления функций, а не `имя: имя`
    assert.ok(html.includes('function filterRuns(runs, filter)'), 'модуль фильтра не вставлен');
    assert.ok(html.includes('function emptyStateText(filter)'), 'нет функции пустого состояния');
    assert.ok(html.includes('window.HistoryFilters = api') || html.includes('root.HistoryFilters = api'), 'модуль не экспортирует HistoryFilters');
    assert.ok(!html.includes('window.HistoryFilters = { filterRuns: function (runs) { return runs.slice(); }'), 'сработала заглушка деградации — файл не найден');
  });
});
