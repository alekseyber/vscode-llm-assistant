// Тесты для RunHistoryStore — хранилище истории запусков (Задача 6, слой 07)
// Проверяет FIFO (AC-6.6), персистентность, уникальность ID, очистку

import 'mocha';
import * as sinon from 'sinon';
import * as assert from 'assert';
import {
  RunHistoryStore,
  RunEntry,
  generateRunId,
} from '../../src/shared/RunHistoryStore';

/** Создать тестовую запись запуска */
function makeEntry(overrides: Partial<RunEntry> = {}): RunEntry {
  return {
    id: generateRunId(),
    timestamp: Date.now(),
    mode: 'chat',
    task: 'Тестовая задача',
    provider: 'deepseek',
    model: 'deepseek-chat',
    steps: 1,
    tokensIn: 100,
    tokensOut: 50,
    cost: 0.001,
    duration: 500,
    status: 'success',
    ...overrides,
  };
}

suite('RunHistoryStore', () => {
  let sandbox: sinon.SinonSandbox;
  let globalState: any;
  let store: RunHistoryStore;

  setup(() => {
    sandbox = sinon.createSandbox();

    // Мок globalState с внутренним хранилищем
    let storage: RunEntry[] = [];
    globalState = {
      get: sandbox.stub().callsFake((_key: string, defaultValue: unknown) => {
        return storage.length > 0 ? storage : defaultValue;
      }),
      update: sandbox.stub().callsFake((_key: string, value: RunEntry[]) => {
        storage = [...value];
        return Promise.resolve();
      }),
      keys: sandbox.stub().returns([]),
      setKeysForSync: sandbox.stub(),
    };

    store = new RunHistoryStore(globalState);
  });

  teardown(() => sandbox.restore());

  // --- AC-6.6: Max 100 записей, старые вытесняются ---

  test('getRuns() возвращает пустой массив при отсутствии истории', () => {
    const runs = store.getRuns();
    assert.deepStrictEqual(runs, []);
  });

  test('recordRun() добавляет запись', () => {
    const entry = makeEntry();
    store.recordRun(entry);

    const runs = store.getRuns();
    assert.strictEqual(runs.length, 1);
    assert.strictEqual(runs[0].id, entry.id);
    assert.strictEqual(runs[0].mode, entry.mode);
    assert.strictEqual(runs[0].task, entry.task);
  });

  test('recordRun() сохраняет sessionId (для перехода к сессии по двойному клику)', () => {
    store.recordRun(makeEntry({ sessionId: 'session_abc123' }));

    const runs = store.getRuns();
    assert.strictEqual(runs[0].sessionId, 'session_abc123');
  });

  test('recordRun() без sessionId — поле отсутствует', () => {
    store.recordRun(makeEntry());

    const runs = store.getRuns();
    assert.strictEqual(runs[0].sessionId, undefined);
  });

  test('updateRun() обновляет существующую запись по id (running → success)', () => {
    store.recordRun(makeEntry({ id: 'run-1', status: 'running', tokensOut: 0 }));

    store.updateRun('run-1', { status: 'success', tokensOut: 999, duration: 500, steps: 3 });

    const run = store.getRuns()[0];
    assert.strictEqual(run.status, 'success');
    assert.strictEqual(run.tokensOut, 999);
    assert.strictEqual(run.duration, 500);
    assert.strictEqual(run.steps, 3);
    assert.strictEqual(run.id, 'run-1'); // id не меняется
    assert.strictEqual(store.getRuns().length, 1); // новая запись не создаётся
  });

  test('updateRun() игнорирует несуществующий id', () => {
    store.recordRun(makeEntry({ id: 'run-1', status: 'running' }));

    store.updateRun('run-nonexistent', { status: 'success' });

    const runs = store.getRuns();
    assert.strictEqual(runs.length, 1);
    assert.strictEqual(runs[0].status, 'running'); // исходная запись не меняется
  });

  test('getRun() возвращает запись по id или undefined', () => {
    store.recordRun(makeEntry({ id: 'run-abc', task: 'Найти меня' }));

    assert.strictEqual(store.getRun('run-abc')?.task, 'Найти меня');
    assert.strictEqual(store.getRun('run-missing'), undefined);
  });

  test('жизненный цикл: recordRun(running) + updateRun(success) = одна запись (без «сирот»)', () => {
    // Один запуск = одна запись: recordRun создаёт 'running', updateRun переводит в финал.
    // Регрессия: двойной recordRunStart (Plan Mode) создавал 2 записи — одну осиротевшую 'running'.
    store.recordRun(makeEntry({ id: 'run-1', status: 'running', task: 'план' }));
    store.updateRun('run-1', { status: 'success', duration: 500, steps: 3 });

    const runs = store.getRuns();
    assert.strictEqual(runs.length, 1, 'не должно быть второй (осиротевшей) записи');
    assert.strictEqual(runs[0].id, 'run-1');
    assert.strictEqual(runs[0].status, 'success');
    assert.strictEqual(runs[0].duration, 500);
  });

  test('recordRun() + updateRun() разных id — это две разные записи (как генерация и имплементация плана)', () => {
    // Генерация плана и имплементация — это два ОТДЕЛЬНЫХ запуска с разными id.
    store.recordRun(makeEntry({ id: 'run-gen', status: 'running', task: 'Генерация плана' }));
    store.updateRun('run-gen', { status: 'success' });
    store.recordRun(makeEntry({ id: 'run-impl', status: 'running', task: 'Имплементация плана' }));

    const runs = store.getRuns();
    assert.strictEqual(runs.length, 2);
    assert.strictEqual(runs[0].id, 'run-impl'); // новые сверху
    assert.strictEqual(runs[1].id, 'run-gen');
    assert.strictEqual(runs[0].status, 'running');
    assert.strictEqual(runs[1].status, 'success');
  });

  test('новые записи добавляются в начало (сортировка от новых к старым)', () => {
    store.recordRun(makeEntry({ id: 'run-1', timestamp: 1000 }));
    store.recordRun(makeEntry({ id: 'run-2', timestamp: 2000 }));

    const runs = store.getRuns();
    assert.strictEqual(runs.length, 2);
    assert.strictEqual(runs[0].id, 'run-2'); // Самая новая — первая
    assert.strictEqual(runs[1].id, 'run-1');
  });

  test('getRuns(limit) возвращает не больше limit записей', () => {
    for (let i = 0; i < 10; i++) {
      store.recordRun(makeEntry({ id: `run-${i}` }));
    }

    const runs = store.getRuns(3);
    assert.strictEqual(runs.length, 3);
    assert.strictEqual(runs[0].id, 'run-9'); // Самая новая
  });

  test('FIFO: максимум 100 записей, 101-я вытесняет самую старую (AC-6.6)', () => {
    // Добавляем 100 записей
    for (let i = 0; i < 100; i++) {
      store.recordRun(makeEntry({ id: `run-${i}` }));
    }
    assert.strictEqual(store.getRuns().length, 100);
    // Самая старая — run-0 (последняя в массиве)
    assert.strictEqual(store.getRuns()[99].id, 'run-0');

    // Добавляем 101-ю — старая вытесняется
    store.recordRun(makeEntry({ id: 'run-newest' }));
    const runs = store.getRuns();
    assert.strictEqual(runs.length, 100);
    assert.strictEqual(runs[0].id, 'run-newest'); // Новая — первая
    assert.strictEqual(runs[99].id, 'run-1');     // Старая run-0 вытеснена
  });

  test('FIFO: 150 записей → только 100 сохранено', () => {
    for (let i = 0; i < 150; i++) {
      store.recordRun(makeEntry({ id: `run-${i}` }));
    }
    const runs = store.getRuns();
    assert.strictEqual(runs.length, 100);
    // Первая (новая) должна быть run-149
    assert.strictEqual(runs[0].id, 'run-149');
    // Последняя (старая) должна быть run-50
    assert.strictEqual(runs[99].id, 'run-50');
  });

  // --- Очистка ---

  test('clearHistory() удаляет все записи', () => {
    store.recordRun(makeEntry());
    store.recordRun(makeEntry());
    assert.strictEqual(store.getRuns().length, 2);

    store.clearHistory();
    assert.strictEqual(store.getRuns().length, 0);
  });

  test('clearSessionReferences() очищает sessionId у запусков удалённой сессии', () => {
    store.recordRun(makeEntry({ id: 'run-1', sessionId: 'session_deleted' }));
    store.recordRun(makeEntry({ id: 'run-2', sessionId: 'session_kept' }));

    store.clearSessionReferences('session_deleted');

    const runs = store.getRuns();
    const deletedRun = runs.find(r => r.id === 'run-1');
    const keptRun = runs.find(r => r.id === 'run-2');
    assert.strictEqual(deletedRun?.sessionId, undefined, 'привязка к удалённой сессии очищена');
    assert.strictEqual(keptRun?.sessionId, 'session_kept', 'другая сессия не тронута');
  });

  // --- Типы записей ---

  test('корректно сохраняет все поля RunEntry', () => {
    const entry: RunEntry = {
      id: 'run-test-123',
      timestamp: 1723152000000,
      mode: 'agent',
      task: 'Создать функцию parseConfig в src/config.ts',
      provider: 'hermes',
      model: 'deepseek-v4-pro',
      steps: 7,
      tokensIn: 1500,
      tokensOut: 800,
      cost: 0.0035,
      duration: 12500,
      status: 'success',
    };

    store.recordRun(entry);
    const runs = store.getRuns();
    assert.strictEqual(runs.length, 1);
    assert.deepStrictEqual(runs[0], entry);
  });

  test('сохраняет запись с ошибкой (status: error, error? строка)', () => {
    const entry = makeEntry({
      mode: 'agent',
      status: 'error',
      error: 'API вернул 500 Internal Server Error',
    });

    store.recordRun(entry);
    const runs = store.getRuns();
    assert.strictEqual(runs[0].status, 'error');
    assert.strictEqual(runs[0].error, 'API вернул 500 Internal Server Error');
  });

  test('сохраняет запись с cancelled статусом', () => {
    const entry = makeEntry({ mode: 'agent', status: 'cancelled' });
    store.recordRun(entry);
    assert.strictEqual(store.getRuns()[0].status, 'cancelled');
  });

  test('сохраняет запись с limit_exceeded статусом', () => {
    const entry = makeEntry({ mode: 'agent', status: 'limit_exceeded', steps: 20 });
    store.recordRun(entry);
    assert.strictEqual(store.getRuns()[0].status, 'limit_exceeded');
  });

  // --- generateRunId ---

  test('generateRunId() генерирует уникальные ID', () => {
    const ids = new Set<string>();
    for (let i = 0; i < 100; i++) {
      ids.add(generateRunId());
    }
    assert.strictEqual(ids.size, 100, 'Все 100 ID должны быть уникальными');
  });

  test('generateRunId() начинается с run_', () => {
    const id = generateRunId();
    assert.ok(id.startsWith('run_'), 'ID должен начинаться с run_');
    assert.ok(id.length > 10, 'ID должен быть достаточно длинным');
  });

  // --- Персистентность ---

  test('данные сохраняются между созданиями экземпляров (persistent)', () => {
    store.recordRun(makeEntry({ id: 'persistent-run' }));

    // Создаём новый store с тем же globalState
    const store2 = new RunHistoryStore(globalState);
    const runs = store2.getRuns();
    assert.strictEqual(runs.length, 1);
    assert.strictEqual(runs[0].id, 'persistent-run');
  });

  // --- Разные режимы ---

  test('записи всех трёх режимов (chat, agent, edit) сохраняются', () => {
    store.recordRun(makeEntry({ mode: 'chat', id: 'chat-run' }));
    store.recordRun(makeEntry({ mode: 'agent', id: 'agent-run' }));
    store.recordRun(makeEntry({ mode: 'edit', id: 'edit-run' }));

    const runs = store.getRuns();
    assert.strictEqual(runs.length, 3);

    const modes = runs.map((r) => r.mode);
    assert.ok(modes.includes('chat'));
    assert.ok(modes.includes('agent'));
    assert.ok(modes.includes('edit'));
  });
});
