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
    assert.strictEqual(sessions[0].name, 'Новая сессия');
  });

  test('createSession() добавляет сессию', () => {
    const sm = new SessionManager(storage);
    sm.createSession('Тест');
    const sessions = sm.listSessions();
    assert.strictEqual(sessions.length, 2);
    assert.strictEqual(sessions[0].name, 'Тест'); // Самая новая сверху
  });

  test('switchTo() меняет активную сессию', () => {
    const sm = new SessionManager(storage);
    const id2 = sm.createSession('Вторая');
    sm.switchTo(id2);
    const active = sm.getActive();
    assert.ok(active);
    assert.strictEqual(active!.meta.id, id2);
  });

  test('deleteSession() удаляет сессию', () => {
    const sm = new SessionManager(storage);
    const id2 = sm.createSession('Удаляемая');
    sm.createSession('Третья');
    const deleted = sm.deleteSession(id2);
    assert.strictEqual(deleted, true);
    assert.strictEqual(sm.listSessions().length, 2);
  });

  test('нельзя удалить последнюю сессию', () => {
    const sm = new SessionManager(storage);
    const sessions = sm.listSessions();
    const deleted = sm.deleteSession(sessions[0].id);
    assert.strictEqual(deleted, false);
    assert.strictEqual(sm.listSessions().length, 1);
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
