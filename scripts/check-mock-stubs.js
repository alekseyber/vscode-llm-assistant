#!/usr/bin/env node
// Ловит «слепые» заглушки событий в моке vscode.
//
// Зачем: мок отдавал `onDidChangeConfiguration() { return { dispose: () => {} }; }`,
// причём в файле таких определений оказалось ДВА — второе перекрывало рабочее.
// Тест мог «поменять настройку» и получить зелёный результат, потому что событие
// никуда не доходило. Тем же классом был `EventEmitter.fire()` без слушателей:
// из-за него дефект «Edit-прогон не появляется в истории» юниты не ловили.
//
// Правило: любой метод `onDid*` в моке должен возвращать реальный emitter.event
// или быть помечен комментарием `// no-op: причина` в пределах своего тела.
//
// Код выхода: 1 — есть слепые заглушки.

'use strict';

const fs = require('fs');
const path = require('path');

const MOCK = path.join(__dirname, '..', 'test', 'mocks', 'vscode', 'index.js');

/** Тело метода: от строки объявления до закрывающей `},` на том же уровне. */
const DECLARATION = /^\s+(onDid\w+)\s*\(/;
const BLIND_BODY = /return\s*\{\s*dispose\s*:\s*\(?\s*\)?\s*=>\s*\{\s*\}\s*\}|return\s*\{\s*dispose\s*\(\s*\)\s*\{\s*\}\s*\}/;

function main() {
  const lines = fs.readFileSync(MOCK, 'utf-8').split('\n');
  const blind = [];

  for (let i = 0; i < lines.length; i += 1) {
    const declaration = DECLARATION.exec(lines[i]);
    if (!declaration) continue;

    // Смотрим объявление и до 4 следующих строк — заглушка бывает многострочной
    const body = lines.slice(i, i + 5).join('\n');
    if (!BLIND_BODY.test(body)) continue;
    if (body.includes('no-op:')) continue;

    blind.push(`${i + 1}: ${declaration[1]} — событие не доставляется`);
  }

  // Одно и то же событие, объявленное дважды, — отдельная ловушка: второе перекрывает первое
  const declared = new Map();
  lines.forEach((line, index) => {
    const declaration = DECLARATION.exec(line);
    if (!declaration) return;
    const name = declaration[1];
    if (declared.has(name)) {
      blind.push(`${index + 1}: ${name} объявлен повторно (первое объявление — строка ${declared.get(name)})`);
    } else {
      declared.set(name, index + 1);
    }
  });

  if (blind.length > 0) {
    console.error('[MOCK] ❌ проблемы с событиями в test/mocks/vscode/index.js:');
    for (const item of blind) console.error('  ' + item);
    console.error('[MOCK] Верните реальный EventEmitter.event, уберите дубль или пометьте «no-op: причина».');
    process.exit(1);
  }

  console.log('[MOCK] ✅ события в моке живые, дублей нет');
}

main();
