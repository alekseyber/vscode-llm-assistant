// toolbar.js — декларативный реестр действий тулбара панели чата (P0, Этап 1)
// UMD: в WebView — window.TOOLBAR_ACTIONS, в юнит-тестах — require() возвращает массив.
//
// Поля записи:
//   id      — уникальный идентификатор (атрибут data-action-id)
//   icon    — emoji-иконка
//   title   — подпись / тултип
//   action  — строковый дискриминатор (main.js маппит его в обработчик)
//   primary — true = видимая кнопка в шапке, false = в ⋮-меню (AC P0-1.2)
//   danger  — деструктивное действие (красная стилизация в ⋮-меню)
//
// Правило (AC P0-1.4): деструктив (очистить / удалить сессию / удалить все) — primary:false.
// Правило (AC P0-1.5): новая кнопка = +1 запись сюда, HTML трогать не нужно.

(function (root, factory) {
  var api = factory();
  if (typeof module === 'object' && module.exports) {
    module.exports = api;
  } else {
    root.TOOLBAR_ACTIONS = api;
  }
}(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  var TOOLBAR_ACTIONS = [
    { id: 'new-session',    icon: '➕',  title: 'Новая сессия',            action: 'newSession',    primary: true,  danger: false },
    { id: 'share',          icon: '📋',  title: 'Копировать сессию в буфер', action: 'share',       primary: true,  danger: false },
    { id: 'export',         icon: '📥',  title: 'Экспорт в Markdown',      action: 'export',        primary: false, danger: false },
    { id: 'clear',          icon: '✖️',  title: 'Очистить историю',        action: 'clearHistory',  primary: false, danger: true  },
    { id: 'delete-session', icon: '🗑️',  title: 'Удалить сессию',          action: 'deleteSession', primary: false, danger: true  },
    { id: 'delete-all',     icon: '🗑️',  title: 'Удалить все сессии',      action: 'deleteAll',     primary: false, danger: true  },
  ];

  return TOOLBAR_ACTIONS;
}));
