// Страж документации: манифест не должен расходиться с README.
// Ловит именно тот класс дефекта, когда настройка есть в коде, но не описана
// (или описана в README, но в настройках VS Code видна пустой строкой).

import 'mocha';
import * as assert from 'assert';
import * as fs from 'fs';
import * as path from 'path';

const ROOT = path.resolve(__dirname, '../../..');

suite('Документация / манифест ↔ README', () => {
  const fsLocal = fs;
  const pkg = JSON.parse(fs.readFileSync(path.join(ROOT, 'package.json'), 'utf-8'));
  const readme = fs.readFileSync(path.join(ROOT, 'README.md'), 'utf-8');
  const props = pkg.contributes.configuration.properties as Record<string, any>;

  test('DOC-1: каждая настройка из манифеста описана в README', () => {
    const missing = Object.keys(props).filter((key) => {
      const short = key.replace('llmAssistant.', '');
      return !readme.includes(key) && !readme.includes('`' + short + '`');
    });
    assert.deepStrictEqual(missing, [], `нет в README: ${JSON.stringify(missing)}`);
  });

  test('DOC-2: у каждой настройки непустое description (видно в настройках VS Code)', () => {
    const empty = Object.entries(props).filter(([, v]) => !String(v.description ?? '').trim()).map(([k]) => k);
    assert.deepStrictEqual(empty, [], `пустое description: ${JSON.stringify(empty)}`);
  });

  test('DOC-3: каждая команда из манифеста упомянута в README', () => {
    const missing = pkg.contributes.commands
      .map((c: any) => c.title)
      .filter((title: string) => !readme.includes(title));
    assert.deepStrictEqual(missing, [], `команды без описания в README: ${JSON.stringify(missing)}`);
  });
});

// ─────────── Справочник .llma ───────────
suite('Документация / .llma', () => {
  const fs2 = require('fs');
  const path2 = require('path');
  const ROOT2 = path2.resolve(__dirname, '../../..');
  const doc = fs2.readFileSync(path2.join(ROOT2, 'docs', 'llma.md'), 'utf-8');
  const readme2 = fs2.readFileSync(path2.join(ROOT2, 'README.md'), 'utf-8');

  test('DOC-4: справочник .llma покрывает все сущности папки', () => {
    for (const token of ['main.md', 'AGENTS.md', 'agents/', 'skills/', 'plans/', '@orchestrate', 'frontmatter']) {
      assert.ok(doc.includes(token), `в docs/llma.md нет упоминания «${token}»`);
    }
    assert.ok(readme2.includes('docs/llma.md'), 'README не ссылается на docs/llma.md');
  });

  test('DOC-5: числа в справочнике совпадают с дефолтами манифеста', () => {
    const pkg = JSON.parse(fs2.readFileSync(path2.join(ROOT2, 'package.json'), 'utf-8'));
    const props = pkg.contributes.configuration.properties as Record<string, any>;
    const checked: string[] = [];

    for (const [key, value] of Object.entries(props) as [string, any][]) {
      if (typeof value.default !== 'number') continue;
      const m = new RegExp('`' + key.replace(/[.]/g, '\\.') + '`' + '\\s*=\\s*(\\d+)').exec(doc);
      if (!m) continue;
      assert.strictEqual(Number(m[1]), value.default, `${key}: в справочнике ${m[1]}, в манифесте ${value.default}`);
      checked.push(key);
    }

    assert.ok(checked.length >= 5, `сверено слишком мало настроек: ${checked.length}`);
  });
});

// ─────────── Команды установки без привязки к версии ───────────
suite('Документация / установка VSIX', () => {
  const fs3 = require('fs');
  const path3 = require('path');
  const ROOT3 = path3.resolve(__dirname, '../../..');
  const readme3 = fs3.readFileSync(path3.join(ROOT3, 'README.md'), 'utf-8');

  test('DOC-6: в README нет жёстко зашитой версии VSIX', () => {
    const hardcoded = readme3.match(/vscode-llm-assistant-\d+\.\d+\.\d+\.vsix/g) ?? [];
    assert.deepStrictEqual(hardcoded, [], `команда установки привязана к версии: ${JSON.stringify(hardcoded)}`);
  });
});
