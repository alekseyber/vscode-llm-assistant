// E2E-14: вкладка «История» на живой панели — обновление без перезагрузки и панель деталей.
//
// Почему e2e: юниты `HV-*` проверяют HTML и сборку сообщений в изоляции, а известный дефект
// был именно в связке «прогон прошёл → запись появилась в открытой вкладке». Здесь прогон
// пишет настоящий RunHistoryStore (Memento рабочего пространства), вкладка — фейковая
// WebviewView из helpers, то есть проверяется фактическая доставка сообщения в панель.
//
// Фильтр по статусу живёт в JS панели (src/webviews/history/main.js) и через e2e недоступен:
// в хосте нет исполнения скриптов webview. Он покрыт юнитами `HV-*`; здесь — только то,
// что ломается тихо.

import 'mocha';
import * as assert from 'assert';
import * as vscode from 'vscode';
import { HistoryViewProvider } from '../../../src/modes/history/HistoryViewProvider';
import { RunEntry, RunHistoryStore } from '../../../src/shared/RunHistoryStore';
import { createFakeWebviewView, messagesOfType } from './helpers/webview';
import { waitFor } from './helpers/wait';

/** Memento в памяти: настоящий интерфейс, без записи на диск между прогонами. */
function memoryMemento(): vscode.Memento {
  const data = new Map<string, unknown>();
  return {
    get: <T>(key: string, fallback?: T) => (data.has(key) ? (data.get(key) as T) : (fallback as T)),
    update: async (key: string, value: unknown) => {
      data.set(key, value);
    },
    keys: () => Array.from(data.keys()),
    setKeysForSync: () => undefined,
  } as unknown as vscode.Memento;
}

function entry(id: string, status: RunEntry['status'], task: string): RunEntry {
  return {
    id,
    timestamp: Date.now(),
    mode: 'chat',
    task,
    provider: 'stub',
    model: 'stub-model',
    steps: 1,
    tokensIn: 120,
    tokensOut: 40,
    cost: 0.0001,
    duration: 900,
    status,
    ...(status === 'error' ? { error: 'провайдер вернул 500' } : {}),
  };
}

suite('E2E-14: вкладка «История»', () => {
  // Честное имя: тест проверяет ДОСТАВКУ сообщения в панель, а не перерисовку таблицы —
  // рендер живёт в скрипте webview, который в Extension Host не исполняется.
  test('14a: при записи прогона провайдер отправляет обновление в открытую панель', async () => {
    const store = new RunHistoryStore(memoryMemento());
    const provider = new HistoryViewProvider(store);
    const view = createFakeWebviewView();

    provider.resolveWebviewView(view as any, {} as any, { isCancellationRequested: false } as any);
    assert.ok(view.webview.html.includes('История'), 'панель отрисована');
    const initial = messagesOfType(view, 'refresh').length;

    // Прогон пишет не чат, а хранилище — именно так ломался сценарий «записи нет»
    store.recordRun(entry('run_e2e_1', 'success', 'что такое замыкание'));

    await waitFor(() => messagesOfType(view, 'refresh').length > initial, 3000);
    const refresh = messagesOfType(view, 'refresh').at(-1);
    assert.ok(Array.isArray(refresh.runs), 'в сообщении есть список прогонов');
    assert.strictEqual(refresh.runs.length, 1, `в списке ровно один прогон: ${JSON.stringify(refresh.runs)}`);
    assert.strictEqual(refresh.runs[0].id, 'run_e2e_1', 'это тот самый прогон');
    assert.ok(
      typeof refresh.statsLine === 'string' && refresh.statsLine.length > 0,
      `строка сводки не пустая: ${refresh.statsLine}`,
    );

  });

  test('14b: детали прогона приходят по запросу панели и содержат причину ошибки', async () => {
    const store = new RunHistoryStore(memoryMemento());
    const provider = new HistoryViewProvider(store);
    const view = createFakeWebviewView();
    provider.resolveWebviewView(view as any, {} as any, { isCancellationRequested: false } as any);

    store.recordRun(entry('run_e2e_2', 'error', 'правка функции расчёта'));
    await waitFor(() => messagesOfType(view, 'refresh').length > 0, 3000);

    // Протокол панели: запрос деталей — это `getDetails` с `runId`, ответ — `runDetails`
    view.send({ type: 'getDetails', runId: 'run_e2e_2' });
    await waitFor(() => messagesOfType(view, 'runDetails').length > 0, 3000);

    const details = messagesOfType(view, 'runDetails').at(-1);
    // Контракт «запись → детали»: панель рисует все эти поля, значит они обязаны доехать
    const got = details.entry;
    assert.strictEqual(got.id, 'run_e2e_2', 'детали по тому же прогону');
    assert.strictEqual(got.status, 'error', 'статус из записи');
    assert.strictEqual(got.task, 'правка функции расчёта', 'задача');
    assert.strictEqual(got.mode, 'chat', 'режим');
    assert.strictEqual(got.provider, 'stub', 'провайдер');
    assert.strictEqual(got.model, 'stub-model', 'модель');
    assert.strictEqual(got.steps, 1, 'шаги');
    assert.strictEqual(got.tokensIn, 120, 'входные токены');
    assert.strictEqual(got.tokensOut, 40, 'выходные токены');
    assert.strictEqual(got.cost, 0.0001, 'стоимость');
    assert.strictEqual(got.duration, 900, 'длительность');
    assert.ok(
      String(got.error ?? '').includes('500'),
      `панель получает причину ошибки, а не только статус: ${JSON.stringify(got)}`,
    );

  });

  test('14c: пустая история не ломает вкладку', async () => {
    const store = new RunHistoryStore(memoryMemento());
    const provider = new HistoryViewProvider(store);
    const view = createFakeWebviewView();
    provider.resolveWebviewView(view as any, {} as any, { isCancellationRequested: false } as any);

    // Провайдер вправе не отправлять refresh до первого изменения — важно, что отрисовка есть
    assert.ok(view.webview.html.includes('История'), 'вкладка отрисована на пустой истории');
    assert.strictEqual(store.getRuns().length, 0, 'история пуста');

    // Запрос деталей по несуществующему id не должен ронять панель (молча игнорируется)
    view.send({ type: 'getDetails', runId: 'нет-такого' });
    await new Promise((resolve) => setTimeout(resolve, 100));
    assert.strictEqual(messagesOfType(view, 'runDetails').length, 0, 'по неизвестному id ответа нет');

    // Очистка истории: панель получает refresh с пустым списком, без падения
    store.recordRun(entry('run_e2e_3', 'success', 'раз'));
    await waitFor(() => messagesOfType(view, 'refresh').at(-1)?.runs?.length === 1, 3000);
    store.clearHistory();
    await waitFor(() => messagesOfType(view, 'refresh').at(-1)?.runs?.length === 0, 3000, 50, 'пустой список после очистки');
    assert.deepStrictEqual(messagesOfType(view, 'refresh').at(-1).runs, [], 'список пуст');

  });
});
