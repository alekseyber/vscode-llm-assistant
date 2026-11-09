#!/usr/bin/env node
// Проверка, что для текущей версии пакета есть раздел в CHANGELOG.
//
// Зачем: релиз 0.14.5x несколько раз собирался без записи (или с записью от прошлой
// версии), и это замечалось уже после публикации — на Marketplace видна история
// версий, а в ней пусто или чужой текст.
//
// Код выхода: 1 — раздела нет.

'use strict';

const fs = require('fs');
const path = require('path');

const root = path.join(__dirname, '..');
const { version } = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf-8'));
const changelog = fs.readFileSync(path.join(root, 'CHANGELOG.md'), 'utf-8');

const heading = new RegExp(`^##\\s+${version.replace(/\./g, '\\.')}\\b`, 'm');

if (!heading.test(changelog)) {
  console.error(`[CHANGELOG] ❌ в CHANGELOG.md нет раздела «## ${version} …»`);
  console.error('[CHANGELOG] Добавьте запись о релизе: что изменилось и какие тесты это держат.');
  process.exit(1);
}

console.log(`[CHANGELOG] ✅ раздел для ${version} есть`);
