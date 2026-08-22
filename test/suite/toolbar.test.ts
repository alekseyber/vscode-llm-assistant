// Тесты декларативного реестра тулбара TOOLBAR_ACTIONS (P0, Этап 1)
// Проверяет целостность данных и правила primary/danger (AC P0-1.1, P0-1.4).

import 'mocha';
import * as assert from 'assert';
import * as path from 'path';

interface ToolbarAction {
  id: string;
  icon: string;
  title: string;
  action: string;
  primary: boolean;
  danger: boolean;
}

// UMD-модуль (raw JS) — грузится напрямую из src/webviews/chat/toolbar.js (не компилируется tsc)
const TOOLBAR_ACTIONS = require(path.resolve(__dirname, '../../../src/webviews/chat/toolbar.js')) as ToolbarAction[];

suite('TOOLBAR_ACTIONS (реестр тулбара)', () => {
  test('все записи имеют обязательные поля (AC P0-1.1)', () => {
    assert.ok(Array.isArray(TOOLBAR_ACTIONS), 'реестр — массив');
    assert.ok(TOOLBAR_ACTIONS.length > 0, 'реестр не пуст');

    for (const a of TOOLBAR_ACTIONS) {
      assert.ok(a.id, `id задан у ${JSON.stringify(a)}`);
      assert.ok(a.icon, `icon задан у ${a.id}`);
      assert.ok(a.title, `title задан у ${a.id}`);
      assert.ok(a.action, `action задан у ${a.id}`);
      assert.strictEqual(typeof a.primary, 'boolean', `primary — boolean у ${a.id}`);
      assert.strictEqual(typeof a.danger, 'boolean', `danger — boolean у ${a.id}`);
    }
  });

  test('id уникальны', () => {
    const ids = TOOLBAR_ACTIONS.map(a => a.id);
    assert.strictEqual(new Set(ids).size, ids.length, 'нет дублей id');
  });

  test('есть хотя бы одно primary-действие (видимая кнопка)', () => {
    assert.ok(TOOLBAR_ACTIONS.some(a => a.primary), 'есть primary');
  });

  test('деструктив — только в ⋮ (primary:false, danger:true) (AC P0-1.4)', () => {
    for (const id of ['clear', 'delete-session', 'delete-all']) {
      const a = TOOLBAR_ACTIONS.find(x => x.id === id);
      assert.ok(a, `${id} есть в реестре`);
      assert.strictEqual(a!.primary, false, `${id} — не на виду`);
      assert.strictEqual(a!.danger, true, `${id} — danger`);
    }
  });

  test('«Удалить все сессии» есть в реестре (AC P0-1.3)', () => {
    const a = TOOLBAR_ACTIONS.find(x => x.id === 'delete-all');
    assert.ok(a, 'delete-all есть');
    assert.strictEqual(a!.action, 'deleteAll', 'action = deleteAll');
    assert.strictEqual(a!.primary, false, 'delete-all в ⋮');
  });

  test('не-деструктивные действия — danger:false', () => {
    for (const id of ['new-session', 'share', 'export']) {
      const a = TOOLBAR_ACTIONS.find(x => x.id === id);
      assert.ok(a, `${id} есть в реестре`);
      assert.strictEqual(a!.danger, false, `${id} — не danger`);
    }
  });
});
