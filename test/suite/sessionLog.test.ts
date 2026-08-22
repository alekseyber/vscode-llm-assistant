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

  // ===== SL-3: deriveMessages — чистая проекция лога в модельный контекст =====

  test('deriveMessages(): user/message + assistant/message → сообщения', () => {
    log.append(ev('user/message', { content: 'привет' }));
    log.append(ev('assistant/message', { content: 'привет!' }));
    log.append(ev('user/message', { content: 'как дела?' }));
    log.append(ev('assistant/message', { content: 'норм' }));

    const messages = log.deriveMessages(sid);
    assert.deepStrictEqual(messages, [
      { role: 'user', content: 'привет' },
      { role: 'assistant', content: 'привет!' },
      { role: 'user', content: 'как дела?' },
      { role: 'assistant', content: 'норм' },
    ]);
  });

  test('deriveMessages(): пропускает tool/call, chunk, step и др.', () => {
    log.append(ev('user/message', { content: 'задача' }));
    log.append(ev('step/start', { stepId: 's1' }));
    log.append(ev('tool/call', { stepId: 's1', name: 'read_file', args: {} }));
    log.append(ev('assistant/chunk', { delta: 'частичный' }));
    log.append(ev('assistant/message', { content: 'готово' }));

    const messages = log.deriveMessages(sid);
    assert.deepStrictEqual(messages, [
      { role: 'user', content: 'задача' },
      { role: 'assistant', content: 'готово' },
    ]);
  });

  test('deriveMessages(): summary-маркер → system + события после него', () => {
    log.append(ev('user/message', { content: 'вопрос 1' }));
    log.append(ev('assistant/message', { content: 'ответ 1' }));
    log.compact(sid, 'краткое содержание');
    log.append(ev('user/message', { content: 'вопрос 2' }));
    log.append(ev('assistant/message', { content: 'ответ 2' }));

    const messages = log.deriveMessages(sid);
    assert.deepStrictEqual(messages, [
      { role: 'system', content: '## Краткое содержание предыдущего диалога:\nкраткое содержание' },
      { role: 'user', content: 'вопрос 2' },
      { role: 'assistant', content: 'ответ 2' },
    ]);
  });

  test('deriveMessages(): чистая проекция — лог не мутирует', () => {
    log.append(ev('user/message', { content: 'a' }));
    log.append(ev('assistant/message', { content: 'b' }));
    const before = log.getEvents(sid).length;
    log.deriveMessages(sid);
    log.deriveMessages(sid, { maxContextTokens: 1 });
    const after = log.getEvents(sid).length;
    assert.strictEqual(before, after, 'deriveMessages не должен менять лог');
  });

  test('deriveMessages({maxContextTokens}): обрезает старые, сохраняет summary и свежие', () => {
    log.compact(sid, 'summary');
    log.append(ev('user/message', { content: 'A'.repeat(40) }));     // 10 токенов
    log.append(ev('assistant/message', { content: 'B'.repeat(40) })); // 10 токенов

    // summary (~13 токенов) + 1 сообщение (10 токенов) = 23 → лимит 25
    const messages = log.deriveMessages(sid, { maxContextTokens: 25 });
    assert.strictEqual(messages[0].role, 'system', 'summary сохраняется');
    assert.strictEqual(messages.length, 2, 'summary + 1 самое свежее');
    assert.strictEqual(messages[1].content, 'B'.repeat(40), 'свежее сохраняется');
  });

  test('deriveMessages(): pendingContext прикрепляется к user/message', () => {
    log.append(ev('user/message', { content: 'текст', pendingContext: 'контекст кода' }));
    const messages = log.deriveMessages(sid);
    assert.strictEqual(messages[0].content, 'контекст кода\nтекст');
  });

  test('compact(): вставляет summary-маркер, история не удаляется', () => {
    log.append(ev('user/message', { content: 'q' }));
    log.append(ev('assistant/message', { content: 'a' }));
    log.compact(sid, 'итог');
    const events = log.getEvents(sid);
    assert.strictEqual(events.length, 3, 'user + assistant + summary');
    assert.strictEqual(events[2].type, 'summary');
    assert.deepStrictEqual((events[2] as any).replacedRange, [0, 2], 'summary заменяет [0,2)');
    // История НЕ удалена
    assert.strictEqual(events[0].type, 'user/message');
    assert.strictEqual(events[1].type, 'assistant/message');
  });
});
