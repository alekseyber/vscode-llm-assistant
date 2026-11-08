// Страж документации: манифест не должен расходиться с README.
// Ловит именно тот класс дефекта, когда настройка есть в коде, но не описана
// (или описана в README, но в настройках VS Code видна пустой строкой).

import 'mocha';
import * as assert from 'assert';
import * as fs from 'fs';
import * as path from 'path';

const ROOT = path.resolve(__dirname, '../../..');

suite('Документация / манифест ↔ README', () => {
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
