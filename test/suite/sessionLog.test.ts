// Тесты для SessionLog — append-only журнал событий сессии (F1)

import 'mocha';
import * as sinon from 'sinon';
import * as assert from 'assert';
import { SessionLog, SessionEvent } from '../../src/shared/SessionLog';

suite('SessionLog', () => {
  let sandbox: sinon.SinonSandbox;
  let storage: any;
  let log: SessionLog;
  const sid = 'session_test';

  setup(() => {
    sandbox = sinon.createSandbox();
    storage = {
      get: sandbox.stub().returns({}),
      update: sandbox.stub().returns(Promise.resolve()),
      keys: sandbox.stub().returns([]),
      setKeysForSync: sandbox.stub(),
    };
    log = new SessionLog(storage);
  });

  teardown(() => sandbox.restore());

  // Хелпер: событие с базовыми полями + переопределением через extra
  const ev = (type: string, extra: Record<string, any> = {}): any =>
    ({ sessionId: sid, ts: 1, type, ...extra });

  test('append() добавляет события в конец лога', () => {
    log.append(ev('user/message', { content: 'привет' }));
    log.append(ev('assistant/message', { content: 'привет!' }));
    const events = log.getEvents(sid);
    assert.strictEqual(events.length, 2);
    assert.strictEqual(events[0].type, 'user/message');
    assert.strictEqual(events[1].type, 'assistant/message');
  });

  test('append() персистит — update вызывается', () => {
    log.append(ev('user/message', { content: 'x' }));
    assert.ok(storage.update.called, 'update должен вызываться при append');
  });

  test('getEvents() возвращает пустой массив для неизвестной сессии', () => {
    assert.deepStrictEqual(log.getEvents('нет_такой'), []);
  });

  test('getEvents(since) фильтрует по времени', () => {
    log.append(ev('user/message', { content: 'a', ts: 100 }));
    log.append(ev('assistant/message', { content: 'b', ts: 200 }));
    const filtered = log.getEvents(sid, 200);
    assert.strictEqual(filtered.length, 1);
    assert.strictEqual((filtered[0] as any).content, 'b');
  });

  test('replay() возвращает полный путь агента (тулы + результаты)', () => {
    log.append(ev('step/start', { stepId: 's1' }));
    log.append(ev('tool/call', { stepId: 's1', name: 'read_file', args: { path: 'a.ts' } }));
    log.append(ev('tool/result', { stepId: 's1', name: 'read_file', result: 'содержимое' }));
    const replay = log.replay(sid);
    assert.strictEqual(replay.length, 3);
    assert.strictEqual(replay[1].type, 'tool/call');
    assert.strictEqual((replay[1] as any).name, 'read_file');
    assert.strictEqual(replay[2].type, 'tool/result');
  });

  test('fork() создаёт копию сессии с новым id', () => {
    log.append(ev('user/message', { content: 'исходное' }));
    const newId = log.fork(sid);
    assert.notStrictEqual(newId, sid);
    const forked = log.getEvents(newId);
    assert.strictEqual(forked.length, 1);
    assert.strictEqual((forked[0] as any).content, 'исходное');
    assert.strictEqual(forked[0].sessionId, newId);
    // Исходная сессия не тронута
    assert.strictEqual(log.getEvents(sid).length, 1);
  });

  test('события изолированы между сессиями', () => {
    log.append(ev('user/message', { content: 'в sid' }));
    log.append({ sessionId: 'session_other', ts: 1, type: 'user/message', content: 'в другой' } as SessionEvent);
    assert.strictEqual(log.getEvents(sid).length, 1);
    assert.strictEqual(log.getEvents('session_other').length, 1);
  });

  test('загрузка из storage — данные восстанавливаются', () => {
    const saved = { [sid]: [{ sessionId: sid, ts: 1, type: 'user/message', content: 'из стора' }] };
    const storage2 = {
      get: sandbox.stub().returns(saved),
      update: sandbox.stub().returns(Promise.resolve()),
      keys: sandbox.stub().returns([]),
      setKeysForSync: sandbox.stub(),
    };
    const log2 = new SessionLog(storage2);
    const events = log2.getEvents(sid);
    assert.strictEqual(events.length, 1);
    assert.strictEqual((events[0] as any).content, 'из стора');
  });
});
