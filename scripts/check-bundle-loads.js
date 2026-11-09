#!/usr/bin/env node
// Проверка, что собранный бандл реально загружается.
//
// Зачем: 09.11 расширение «устанавливалось», но не активировалось — в dist лежал вывод tsc,
// и `require("openai")` падал при загрузке модуля, потому что node_modules в пакет не попадает.
// Ни юнит-тесты, ни e2e этого не видели: они гоняют `out/`, а не то, что уезжает пользователю.
//
// Скрипт подставляет заглушку `vscode` и требует dist/extension.js: если в бандле остался
// внешний require установленного пакета — падаем здесь, а не у пользователя.
//
// Код выхода: 1 — бандл не загружается.

'use strict';

const path = require('path');
const Module = require('module');

const BUNDLE = path.join(__dirname, '..', 'dist', 'extension.js');
const VSCODE_STUB = path.join(__dirname, '..', 'test', 'mocks', 'vscode', 'index.js');

const originalLoad = Module._load;
Module._load = function patched(request, parent, isMain) {
  if (request === 'vscode') return require(VSCODE_STUB);
  return originalLoad.call(this, request, parent, isMain);
};

let bundle;
try {
  bundle = require(BUNDLE);
} catch (error) {
  console.error('[BUNDLE] ❌ бандл не загружается: ' + (error && error.message));
  console.error('[BUNDLE] Обычно это внешний require пакета, которого нет в VSIX (node_modules не пакуются).');
  console.error('[BUNDLE] Проверьте, что `npm run compile` собирает webpack-бандл, а не вывод tsc.');
  process.exit(1);
}

if (typeof bundle.activate !== 'function') {
  console.error('[BUNDLE] ❌ в бандле нет exports.activate');
  process.exit(1);
}
if (typeof bundle.deactivate !== 'function') {
  console.error('[BUNDLE] ❌ в бандле нет exports.deactivate');
  process.exit(1);
}

console.log('[BUNDLE] ✅ dist/extension.js загружается и экспортирует activate/deactivate');
