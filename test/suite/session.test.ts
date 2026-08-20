// Тесты для SessionManager — управление сессиями чата

import 'mocha';
import * as sinon from 'sinon';
import * as vscode from 'vscode';
import * as assert from 'assert';
import { SessionManager, Session } from '../../src/modes/chat/SessionManager';

suite('SessionManager', () => {
  let sandbox: sinon.SinonSandbox;
  let storage: any;

  setup(() => {
    sandbox = sinon.createSandbox();
    storage = {
      get: sandbox.stub().returns({}),
      update: sandbox.stub().returns(Promise.resolve()),
      keys: sandbox.stub().returns([]),
      setKeysForSync: sandbox.stub(),
    };
  });

  teardown(() => sandbox.restore());

  test('создаёт первую сессию при инициализации', () => {
    const sm = new SessionManager(storage);
    const sessions = sm.listSessions();
    assert.strictEqual(sessions.length, 1, 'Должна быть 1 сессия');
    assert.strictEqual(sessions[0].name, 'Сессия 1');
  });

  test('createSession() добавляет сессию', () => {
    const sm = new SessionManager(storage);
    const id = sm.createSession('Тест');
    const sessions = sm.listSessions();
    assert.strictEqual(sessions.length, 2);
    // Ищем сессию по ID — не полагаемся на порядок сортировки
    // (lastActiveAt может совпасть при быстрых вызовах в пределах 1 мс)
    const newSession = sessions.find(s => s.id === id);
    assert.ok(newSession, 'Новая сессия должна быть в списке');
    assert.strictEqual(newSession!.name, 'Тест');
  });

  test('switchTo() меняет активную сессию', () => {
    const sm = new SessionManager(storage);
    const id2 = sm.createSession('Вторая');
    sm.switchTo(id2);
    const active = sm.getActive();
    assert.ok(active);
    assert.strictEqual(active!.meta.id, id2);
  });

  test('addMessageTo() пишет сообщение в конкретную сессию, а не в активную', () => {
    const sm = new SessionManager(storage);
    const id1 = sm.getActive()!.meta.id;
    const id2 = sm.createSession('Вторая'); // активная теперь id2

    // Пишем в НЕактивную сессию id1, пока активна id2
    sm.addMessageTo(id1, { role: 'user', content: 'сообщение в первую' });

    // Активная сессия (id2) не должна получить это сообщение
    assert.strictEqual(sm.getMessages().length, 0);

    // Переключаемся на id1 — сообщение там
    sm.switchTo(id1);
    assert.strictEqual(sm.getMessages().length, 1);
    assert.strictEqual(sm.getMessages()[0].content, 'сообщение в первую');
  });

  test('deleteSession() удаляет сессию', () => {
    const sm = new SessionManager(storage);
    const id2 = sm.createSession('Удаляемая');
    sm.createSession('Третья');
    const deleted = sm.deleteSession(id2);
    assert.strictEqual(deleted, true);
    assert.strictEqual(sm.listSessions().length, 2);
  });

  test('удаление последней сессии — автосоздаёт новую', () => {
    const sm = new SessionManager(storage);
    const sessions = sm.listSessions();
    assert.strictEqual(sessions.length, 1);
    const deleted = sm.deleteSession(sessions[0].id);
    assert.strictEqual(deleted, true);
    // Должна быть создана новая пустая сессия
    assert.strictEqual(sm.listSessions().length, 1);
    assert.notStrictEqual(sm.listSessions()[0].id, sessions[0].id);
  });

  test('autoNameSession() — имя из первого сообщения', () => {
    const sm = new SessionManager(storage);
    const id = sm.createSession();
    sm.addMessage({ role: 'user', content: 'Привет, как дела?' });
    sm.autoNameSession(id);
    const active = sm.getActive();
    assert.strictEqual(active!.meta.name, 'Привет, как дела?');
  });

  test('autoNameSession() — обрезает длинные сообщения', () => {
    const sm = new SessionManager(storage);
    const id = sm.createSession();
    sm.addMessage({ role: 'user', content: 'Очень длинное сообщение которое должно обрезаться до 30 символов' });
    sm.autoNameSession(id);
    const active = sm.getActive();
    assert.strictEqual(active!.meta.name.length, 33); // 30 + '...'
    assert.ok(active!.meta.name.endsWith('...'));
  });

  test('getMessages() возвращает сообщения активной сессии', () => {
    const sm = new SessionManager(storage);
    sm.addMessage({ role: 'user', content: 'msg1' });
    sm.addMessage({ role: 'assistant', content: 'reply1' });
    assert.strictEqual(sm.getMessages().length, 2);
  });

  test('addMessage() обновляет messageCount', () => {
    const sm = new SessionManager(storage);
    sm.addMessage({ role: 'user', content: 'msg1' });
    sm.addMessage({ role: 'user', content: 'msg2' });
    assert.strictEqual(sm.getActive()!.meta.messageCount, 2);
  });

  test('сообщения изолированы между сессиями', () => {
    const sm = new SessionManager(storage);
    const id1 = sm.getActive()!.meta.id;
    sm.addMessage({ role: 'user', content: 'msg-1' });

    const id2 = sm.createSession('Вторая');
    sm.addMessage({ role: 'user', content: 'msg-2' });

    sm.switchTo(id1);
    assert.strictEqual(sm.getMessages().length, 1);
    assert.strictEqual(sm.getMessages()[0].content, 'msg-1');

    sm.switchTo(id2);
    assert.strictEqual(sm.getMessages().length, 1);
    assert.strictEqual(sm.getMessages()[0].content, 'msg-2');
  });

  test('новая сессия — пустая история', () => {
    const sm = new SessionManager(storage);
    sm.addMessage({ role: 'user', content: 'msg' });
    sm.createSession('Новая');
    assert.strictEqual(sm.getMessages().length, 0);
  });
});
