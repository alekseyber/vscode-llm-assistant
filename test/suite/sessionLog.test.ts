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

  test('deriveMessagesWithTrimmed(): разделяет kept и trimmed по лимиту', () => {
    log.append(ev('user/message', { content: 'A'.repeat(40) }));     // 10 токенов
    log.append(ev('assistant/message', { content: 'B'.repeat(40) })); // 10 токенов
    log.append(ev('user/message', { content: 'C'.repeat(40) }));      // 10 токенов

    const { messages, trimmed } = log.deriveMessagesWithTrimmed(sid, 22);
    assert.strictEqual(messages.length, 2, '2 свежих (B + C)');
    assert.strictEqual(messages[0].content, 'B'.repeat(40));
    assert.strictEqual(trimmed.length, 1, '1 обрезанное (A)');
    assert.strictEqual(trimmed[0].content, 'A'.repeat(40));
  });

  test('deriveMessages(): pendingContext прикрепляется к user/message', () => {
    log.append(ev('user/message', { content: 'текст', pendingContext: 'контекст кода' }));
    const messages = log.deriveMessages(sid);
    assert.strictEqual(messages[0].content, 'контекст кода\nтекст');
  });

  test('deriveMessages({includeContext:false}): чистый промпт без pendingContext (P0-fix)', () => {
    log.append(ev('user/message', { content: 'текст', pendingContext: 'контекст кода' }));
    const messages = log.deriveMessages(sid, { includeContext: false });
    assert.strictEqual(messages[0].content, 'текст', 'чистый контент без контекста кода');
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

  test('deleteSession(): удаляет лог из памяти и ключ из Memento', () => {
    log.append(ev('user/message', { content: 'q' }));
    assert.strictEqual(log.getEvents(sid).length, 1, 'до удаления 1 событие');

    log.deleteSession(sid);
    assert.strictEqual(log.getEvents(sid).length, 0, 'в памяти удалён');
    assert.ok(storage.update.calledWith(`llmAssistant.sessionLog.${sid}`, undefined), 'ключ удалён из Memento (update c undefined)');
  });

  test('pruneUnknown(): удаляет логи сессий, которых нет в реестре', () => {
    log.append(ev('user/message', { content: 'валидное' }));
    const orphanId = 'session_orphan';
    log.append({ sessionId: orphanId, ts: Date.now(), type: 'user/message', content: 'сирота' });

    const removed = log.pruneUnknown([sid]);
    assert.strictEqual(removed, 1, '1 сирота удалена');
    assert.strictEqual(log.getEvents(sid).length, 1, 'валидная сессия осталась');
    assert.strictEqual(log.getEvents(orphanId).length, 0, 'сирота удалена из памяти');
    assert.ok(storage.update.calledWith(`llmAssistant.sessionLog.${orphanId}`, undefined), 'ключ сироты удалён из Memento');
  });

  test('clearAll(): удаляет все логи', () => {
    log.append(ev('user/message', { content: 'q' }));
    log.append({ sessionId: 'session_other', ts: Date.now(), type: 'user/message', content: 'другая' });
    assert.strictEqual(log.getEvents(sid).length, 1);
    assert.strictEqual(log.getEvents('session_other').length, 1);

    log.clearAll();
    assert.strictEqual(log.getEvents(sid).length, 0, 'все логи очищены');
    assert.strictEqual(log.getEvents('session_other').length, 0, 'все логи очищены (другая сессия)');
  });

  test('truncate(): обрезает старые события, оставляет summary + свежие', () => {
    log.append(ev('user/message', { content: 'A' }));
    log.append(ev('assistant/message', { content: 'B' }));
    log.append(ev('user/message', { content: 'C' }));

    log.truncate(sid, 'итог A+B', 1);

    const events = log.getEvents(sid);
    assert.strictEqual(events.length, 2, 'summary + 1 свежее');
    assert.strictEqual(events[0].type, 'summary');
    assert.strictEqual((events[0] as any).content, 'итог A+B');
    assert.strictEqual(events[1].type, 'user/message');
    assert.strictEqual((events[1] as any).content, 'C');
  });

  test('truncate(): сохраняет tool-события свежих сообщений', () => {
    log.append(ev('user/message', { content: 'задача1' }));
    log.append(ev('tool/call', { stepId: 's1', name: 'read_file', args: {} }));
    log.append(ev('assistant/message', { content: 'ответ1' }));
    log.append(ev('user/message', { content: 'задача2' }));
    log.append(ev('tool/call', { stepId: 's2', name: 'read_file', args: {} }));
    log.append(ev('assistant/message', { content: 'ответ2' }));

    log.truncate(sid, 'итог', 2);

    const events = log.getEvents(sid);
    assert.strictEqual(events.length, 4, 'summary + 2 сообщения + 1 tool');
    assert.strictEqual(events[0].type, 'summary');
    assert.strictEqual(events[1].type, 'user/message');
    assert.strictEqual(events[2].type, 'tool/call');
    assert.strictEqual(events[3].type, 'assistant/message');
  });

  // ===== SL-8: computeStats — производные метрики из лога =====

  test('computeStats(): считает steps (tool/call), тулы, ошибки, сообщения', () => {
    log.append(ev('user/message', { content: 'задача' }));
    log.append(ev('tool/call', { stepId: 's1', name: 'read_file', args: {} }));
    log.append(ev('tool/result', { stepId: 's1', name: 'read_file', result: 'x' }));
    log.append(ev('tool/call', { stepId: 's2', name: 'write_file', args: {} }));
    log.append(ev('tool/result', { stepId: 's2', name: 'write_file', result: 'y' }));
    log.append(ev('assistant/message', { content: 'готово' }));

    const stats = log.computeStats(sid);
    assert.strictEqual(stats.steps, 2, '2 tool/call = 2 шага');
    assert.strictEqual(stats.toolCalls, 2);
    assert.strictEqual(stats.toolResults, 2);
    assert.strictEqual(stats.userMessages, 1);
    assert.strictEqual(stats.assistantMessages, 1);
    assert.strictEqual(stats.errors, 0);
  });

  test('computeStats(): пустая сессия → нули', () => {
    const stats = log.computeStats('нет_такой');
    assert.deepStrictEqual(stats, {
      steps: 0, toolCalls: 0, toolResults: 0, errors: 0,
      userMessages: 0, assistantMessages: 0, chunks: 0,
    });
  });

  test('computeStats(): считает ошибки и чанки', () => {
    log.append(ev('error', { message: 'сбой' }));
    log.append(ev('assistant/chunk', { delta: 'частичный' }));
    const stats = log.computeStats(sid);
    assert.strictEqual(stats.errors, 1);
    assert.strictEqual(stats.chunks, 1);
  });

  // ===== Per-session хранение (оптимизация Memento: без полного переписывания) =====

  test('append() сохраняет под per-session ключом', () => {
    log.append(ev('user/message', { content: 'x' }));
    const updateCalls = storage.update.getCalls();
    assert.ok(updateCalls.length > 0, 'update должен вызываться');
    const key = updateCalls[updateCalls.length - 1].args[0];
    assert.strictEqual(key, `llmAssistant.sessionLog.${sid}`, 'ключ должен быть per-session');
  });

  test('загрузка из per-session ключей — данные восстанавливаются', () => {
    const key = `llmAssistant.sessionLog.${sid}`;
    const events = [{ sessionId: sid, ts: 1, type: 'user/message', content: 'из per-session' }];
    const storage2 = {
      keys: sandbox.stub().returns([key]),
      get: sandbox.stub().callsFake((k: string, d: any) => (k === key ? events : d)),
      update: sandbox.stub().returns(Promise.resolve()),
      setKeysForSync: sandbox.stub(),
    };
    const log2 = new SessionLog(storage2);
    const loaded = log2.getEvents(sid);
    assert.strictEqual(loaded.length, 1);
    assert.strictEqual((loaded[0] as any).content, 'из per-session');
  });

  // ===== SL-9: миграция старых сессий ({meta, messages[]} → события) =====

  test('migrateLegacySessions(): {meta, messages[]} → user/message + assistant/message', () => {
    const legacy = {
      session_old: {
        meta: { lastActiveAt: 100 },
        messages: [
          { role: 'user', content: 'привет' },
          { role: 'assistant', content: 'привет!' },
        ],
      },
    };
    const storage2 = {
      keys: sandbox.stub().returns([]),
      get: sandbox.stub().callsFake((k: string, d: any) => {
        if (k === 'llmAssistant.chat.sessions') return legacy;
        if (k === 'llmAssistant.sessionLog.migrated') return undefined;
        return d;
      }),
      update: sandbox.stub().returns(Promise.resolve()),
      setKeysForSync: sandbox.stub(),
    };
    const log2 = new SessionLog(storage2);
    const events = log2.getEvents('session_old');
    assert.strictEqual(events.length, 2);
    assert.strictEqual(events[0].type, 'user/message');
    assert.strictEqual((events[0] as any).content, 'привет');
    assert.strictEqual(events[1].type, 'assistant/message');
    assert.strictEqual((events[1] as any).content, 'привет!');
  });

  test('migrateLegacySessions(): однократно + пропускает system', () => {
    const legacy = {
      session_old: {
        meta: { lastActiveAt: 1 },
        messages: [
          { role: 'system', content: 'инструкция' },
          { role: 'user', content: 'вопрос' },
          { role: 'assistant', content: 'ответ' },
        ],
      },
    };
    let migratedFlag: string | undefined;
    const storage2 = {
      keys: sandbox.stub().returns([]),
      get: sandbox.stub().callsFake((k: string, d: any) => {
        if (k === 'llmAssistant.chat.sessions') return legacy;
        if (k === 'llmAssistant.sessionLog.migrated') return migratedFlag;
        return d;
      }),
      update: sandbox.stub().callsFake((k: string, v: any) => {
        if (k === 'llmAssistant.sessionLog.migrated') migratedFlag = v;
        return Promise.resolve();
      }),
      setKeysForSync: sandbox.stub(),
    };
    const log2 = new SessionLog(storage2);
    const events = log2.getEvents('session_old');
    assert.strictEqual(events.length, 2, 'system пропущен, user+assistant сохранены');
    const again = log2.migrateLegacySessions();
    assert.strictEqual(again, 0, 'повторная миграция вернёт 0 (флаг done)');
    assert.strictEqual(log2.getEvents('session_old').length, 2, 'не дублирует');
  });

  test('migrateLegacySessions(): не трогает сессии с уже существующими событиями', () => {
    const existingKey = 'llmAssistant.sessionLog.session_old';
    const existingEvents = [{ sessionId: 'session_old', ts: 1, type: 'user/message', content: 'уже в логе' }];
    const legacy = {
      session_old: { meta: { lastActiveAt: 1 }, messages: [{ role: 'user', content: 'из старого стора' }] },
    };
    const storage2 = {
      keys: sandbox.stub().returns([existingKey]),
      get: sandbox.stub().callsFake((k: string, d: any) => {
        if (k === existingKey) return existingEvents;
        if (k === 'llmAssistant.chat.sessions') return legacy;
        if (k === 'llmAssistant.sessionLog.migrated') return undefined;
        return d;
      }),
      update: sandbox.stub().returns(Promise.resolve()),
      setKeysForSync: sandbox.stub(),
    };
    const log2 = new SessionLog(storage2);
    const events = log2.getEvents('session_old');
    assert.strictEqual(events.length, 1, 'не дублирует: остаются существующие события');
    assert.strictEqual((events[0] as any).content, 'уже в логе', 'существующие события не перезаписаны');
  });

  // ===== UI-хвост: toTranscript (экспорт/реплей) + fork(targetId) =====

  test('toTranscript(): markdown с пользователем/ассистентом/тулами', () => {
    log.append(ev('user/message', { content: 'привет' }));
    log.append(ev('tool/call', { stepId: 's1', name: 'read_file', args: { path: 'a.ts' } }));
    log.append(ev('tool/result', { stepId: 's1', name: 'read_file', result: 'содержимое' }));
    log.append(ev('assistant/message', { content: 'готово' }));

    const t = log.toTranscript(sid);
    assert.ok(t.includes(`# Сессия: ${sid}`), 'заголовок сессии');
    assert.ok(t.includes('## 👤 Пользователь'), 'секция пользователя');
    assert.ok(t.includes('привет'), 'текст пользователя');
    assert.ok(t.includes('### 01-agent'), 'заголовок воркера (дефолт agent)');
    assert.ok(t.includes('🔧 read_file'), 'вызов инструмента');
    assert.ok(t.includes('"path": "a.ts"'), 'аргументы инструмента');
    assert.ok(t.includes('содержимое'), 'результат инструмента');
    assert.ok(t.includes('## 🤖 Ассистент'), 'секция ассистента');
    assert.ok(t.includes('готово'), 'текст ассистента');
  });

  test('toTranscript(): группирует tool-шаги по воркерам (P0-5.2)', () => {
    log.append(ev('tool/call', { stepId: 'a1', name: 'read_file', args: { path: 'a.ts' }, role: 'architect' }));
    log.append(ev('tool/result', { stepId: 'a1', name: 'read_file', result: 'r1', role: 'architect' }));
    log.append(ev('tool/call', { stepId: 'c1', name: 'write_file', args: { path: 'b.ts' }, role: 'coder' }));
    log.append(ev('tool/result', { stepId: 'c1', name: 'write_file', result: 'r2', role: 'coder' }));
    log.append(ev('tool/call', { stepId: 'a2', name: 'search_files', args: { pattern: 'x' }, role: 'architect' }));
    log.append(ev('tool/result', { stepId: 'a2', name: 'search_files', result: 'r3', role: 'architect' }));

    const t = log.toTranscript(sid);
    assert.ok(t.includes('### 01-architect'), 'заголовок 01-architect');
    assert.ok(t.includes('### 02-coder'), 'заголовок 02-coder');
    assert.ok(t.indexOf('### 01-architect') < t.indexOf('### 02-coder'), 'architect раньше coder');
    // Повторный блок architect (после coder) использует тот же индекс 01, а не новый
    assert.strictEqual(t.split('### 01-architect').length - 1, 2, '01-architect встречается дважды');
    assert.ok(!t.includes('### 03-'), 'нет лишних индексов воркеров');
  });

  test('fork(sourceId, targetId): использует переданный id', () => {
    log.append(ev('user/message', { content: 'исходное' }));
    const newId = log.fork(sid, 'session_fixed');
    assert.strictEqual(newId, 'session_fixed');
    const forked = log.getEvents('session_fixed');
    assert.strictEqual(forked.length, 1);
    assert.strictEqual(forked[0].sessionId, 'session_fixed');
    assert.strictEqual((forked[0] as any).content, 'исходное');
  });
});
