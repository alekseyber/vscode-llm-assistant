#!/usr/bin/env node
// Сторож против следов мутационного прогона в дереве.
//
// Зачем: `scripts/mutation-check.js` правит `src/**`, гоняет тесты и восстанавливает файл в
// `finally`. Если процесс убить между записью и восстановлением (перезагрузка гейтвея,
// таймаут), мутация остаётся в дереве. Так в `SkillManifest` оказался `if (false)`, который
// отключил проверку имени скилла, — а тесты при этом были зелёными.
//
// Проверяем два признака:
//   1) маркеры мутаций в `src/**` (`if (false)`, `if (false &&`, `void this.last…` и т.п.);
//   2) незакоммиченные изменения в `src/**` — при обычной работе их быть не должно, а при
//      оборванном прогоне они выглядят как «правка поведения без спеки».
//
// Запуск: node scripts/check-mutations-clean.js [--json]
// Код выхода 1 — найдены следы.

'use strict';

const { execFileSync } = require('child_process');
const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');

/** Маркеры, которые встречаются только в мутациях, а не в рабочем коде. */
const MARKERS = [/\bif\s*\(\s*false\s*\)/g, /\bif\s*\(\s*false\s*&&/g, /\bwhile\s*\(\s*false\s*\)/g];

function walk(dir, out = []) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      if (entry.name === 'node_modules' || entry.name === 'out') continue;
      walk(full, out);
      continue;
    }
    if (entry.name.endsWith('.ts')) out.push(full);
  }
  return out;
}

/** Найти маркеры мутаций в тексте: возвращает номера строк. */
function findMutationTraces(content) {
  const lines = [];
  content.split('\n').forEach((line, index) => {
    if (MARKERS.some((marker) => (marker.lastIndex = 0, marker.test(line)))) {
      lines.push({ line: index + 1, text: line.trim().slice(0, 120) });
    }
  });
  return lines;
}

function main() {
  const asJson = process.argv.includes('--json');
  const srcDir = path.join(ROOT, 'src');
  const traces = [];
  for (const file of walk(srcDir)) {
    const rel = path.relative(ROOT, file).split(path.sep).join('/');
    for (const hit of findMutationTraces(fs.readFileSync(file, 'utf-8'))) {
      traces.push({ file: rel, ...hit });
    }
  }

  let dirty = [];
  try {
    dirty = execFileSync('git', ['status', '--porcelain', '--', 'src'], { cwd: ROOT, encoding: 'utf-8' })
      .split('\n')
      .map((line) => line.trim())
      .filter(Boolean);
  } catch {
    dirty = [];
  }

  if (asJson) {
    console.log(JSON.stringify({ traces, dirty }, null, 2));
  } else {
    console.log(`[mutations-clean] маркеров мутаций: ${traces.length}, изменённых файлов src: ${dirty.length}`);
    for (const hit of traces) console.log(`  ❌ ${hit.file}:${hit.line} — ${hit.text}`);
    for (const line of dirty) console.log(`  ⚠️ незакоммичено: ${line}`);
  }

  process.exit(traces.length > 0 ? 1 : 0);
}

module.exports = { findMutationTraces };

if (require.main === module) main();
