#!/usr/bin/env node
// Копирует runtime-файлы sqlite-wasm в dist/: в VSIX нет node_modules, поэтому модуль
// и .wasm должны лежать рядом с бандлом. Запускается ПОСЛЕ webpack (у него clean: true).

'use strict';

const fs = require('fs');
const path = require('path');

const root = path.join(__dirname, '..');
const source = path.join(root, 'node_modules', '@sqlite.org', 'sqlite-wasm', 'dist');
const target = path.join(root, 'dist', 'sqlite');

const FILES = ['node.mjs', 'index.mjs', 'sqlite3.wasm'];

if (!fs.existsSync(source)) {
  console.error(`[sqlite-assets] не найден пакет: ${source}. Выполните npm install.`);
  process.exit(1);
}

fs.mkdirSync(target, { recursive: true });
for (const file of FILES) {
  const from = path.join(source, file);
  if (!fs.existsSync(from)) {
    console.error(`[sqlite-assets] нет файла ${from}`);
    process.exit(1);
  }
  fs.copyFileSync(from, path.join(target, file));
}

const wasm = fs.statSync(path.join(target, 'sqlite3.wasm'));
console.log(`[sqlite-assets] ✅ dist/sqlite: ${FILES.join(', ')} (wasm ${Math.round(wasm.size / 1024)} КБ)`);
