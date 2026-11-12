#!/usr/bin/env node
// Проверка скиллов в CI: манифест, формат версий, дубли имён.
//
// Зачем: скилл — инструкция агенту. Правка `.md` без версии и без структуры меняет поведение
// молча, и заметить это можно только по диффу. Проверка делает правку видимой: версия,
// дата, обязательные поля, отсутствие дублей.
//
// Запуск: node scripts/check-skills.js [--dir <путь>] [--json]
// По умолчанию проверяются `.llma/skills/*.md` и `.claude/skills/*/SKILL.md` в корне репозитория.
// Если скиллов нет — проверка проходит (в репозитории расширения их может не быть).
// Код выхода 1 — есть ошибки.

'use strict';

const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');

function collect(dir, depth = 3) {
  const files = [];
  if (!fs.existsSync(dir) || depth < 0) return files;
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      // Формат Claude Code: <имя>/SKILL.md; вложенность до depth уровней
      const skill = path.join(full, 'SKILL.md');
      if (fs.existsSync(skill)) files.push(skill);
      files.push(...collect(full, depth - 1));
      continue;
    }
    if (entry.name.endsWith('.md')) files.push(full);
  }
  return files;
}

async function main() {
  const dirIndex = process.argv.indexOf('--dir');
  const sinceIndex = process.argv.indexOf('--since');
  const since = sinceIndex >= 0 ? process.argv[sinceIndex + 1] : undefined;
  const asJson = process.argv.includes('--json');
  const targets =
    dirIndex >= 0
      ? [path.resolve(process.argv[dirIndex + 1])]
      : [path.join(ROOT, '.llma', 'skills'), path.join(ROOT, '.claude', 'skills')];

  // Модуль на TypeScript — берём скомпилированный tsc (out/), не webpack-бандл
  const modulePath = path.join(ROOT, 'out', 'src', 'shared', 'SkillManifest.js');
  if (!fs.existsSync(modulePath)) {
    console.error('[skills] нет out/src/shared/SkillManifest.js — сначала tsc -p tsconfig.test.json');
    process.exit(2);
  }
  const { validateSkillContent, findDuplicateNames, validateChangedSkill } = require(modulePath);

  const entries = [];
  const errors = [];
  for (const dir of targets) {
    for (const file of collect(dir)) {
      const rel = path.relative(ROOT, file).split(path.sep).join('/');
      const content = fs.readFileSync(file, 'utf-8');
      const result = validateSkillContent(content, rel);
      errors.push(...result.errors);
      if (result.name) entries.push({ name: result.name, filePath: rel });
    }
  }
  errors.push(...findDuplicateNames(entries));

  // Правка без отметки: файл изменился, а version/updated — нет
  if (since) {
    const { execFileSync } = require('child_process');
    let raw = '';
    try {
      raw = execFileSync('git', ['diff', '--name-only', since, '--', '.llma', '.claude'], {
        cwd: ROOT,
        encoding: 'utf-8',
      });
    } catch (error) {
      console.error(`[skills] не удалось сравнить с ${since}: ${error.message.split('\n')[0]}`);
      process.exit(2);
    }
    const changed = raw
      .split('\n')
      .map((line) => line.trim())
      .filter((line) => line.endsWith('.md'));

    for (const rel of changed) {
      const full = path.join(ROOT, rel);
      if (!fs.existsSync(full)) {
        // Удаление скилла — не «правка без отметки», но и не молчаливое событие: видно в логе
        console.log(`[skills] удалён скилл: ${rel}`);
        continue;
      }
      let before = '';
      try {
        before = execFileSync('git', ['show', `${since}:${rel}`], { cwd: ROOT, encoding: 'utf-8' });
      } catch {
        continue; // файла не было в базовой ревизии — это новый скилл, а не правка без отметки
      }
      errors.push(...validateChangedSkill(rel, before, fs.readFileSync(full, 'utf-8')));
    }
    if (changed.length === 0) console.log('[skills] изменённых скиллов нет');
  }

  if (asJson) {
    console.log(JSON.stringify({ checked: entries.length, errors }, null, 2));
  } else if (entries.length === 0 && errors.length === 0) {
    console.log('[skills] скиллов не найдено — проверять нечего');
  } else {
    console.log(`[skills] проверено ${entries.length}, ошибок ${errors.length}`);
    for (const error of errors) console.log(`  ❌ ${error}`);
  }

  process.exit(errors.length > 0 ? 1 : 0);
}

main();
