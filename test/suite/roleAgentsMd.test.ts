// Тесты для RoleAgentsMdLoader — .llma/agents/{role}.md и .llma/main.md (MA-5)
import 'mocha';
import * as assert from 'assert';
import * as path from 'path';
import * as fs from 'fs';
import * as os from 'os';
import * as sinon from 'sinon';
import { loadRoleAgentsMd, invalidateRoleCache, parseFrontmatter, getSkillCatalog, getSkillTemplate } from '../../src/shared/RoleAgentsMdLoader';

function setupDir(files: Record<string, string>): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'vscode-llm-test-ma5-'));
  for (const [name, content] of Object.entries(files)) {
    const fp = path.join(dir, name);
    fs.mkdirSync(path.dirname(fp), { recursive: true });
    fs.writeFileSync(fp, content);
  }
  return dir;
}

function mockWs(sb: sinon.SinonSandbox, dir: string): void {
  const vscode = require('vscode');
  sb.stub(vscode.workspace, 'workspaceFolders').value([{ uri: { fsPath: dir } }]);
}

suite('RoleAgentsMdLoader', () => {
  test('MA-5.1: .llma/agents/coder.md загружается', () => {
    invalidateRoleCache();
    const sb = sinon.createSandbox();
    const dir = setupDir({ '.llma/agents/coder.md': 'Пиши чистый код' });
    try {
      mockWs(sb, dir);
      assert.ok(loadRoleAgentsMd('coder')?.includes('Пиши чистый код'));
    } finally { sb.restore(); fs.rmSync(dir, { recursive: true, force: true }); }
  });

  test('MA-5.2: fallback на .llma/main.md если ролевого нет', () => {
    invalidateRoleCache();
    const sb = sinon.createSandbox();
    const dir = setupDir({ '.llma/main.md': 'Общие правила' });
    try {
      mockWs(sb, dir);
      assert.ok(loadRoleAgentsMd('coder')?.includes('Общие правила'));
    } finally { sb.restore(); fs.rmSync(dir, { recursive: true, force: true }); }
  });

  test('Нет файлов — null', () => {
    invalidateRoleCache();
    const sb = sinon.createSandbox();
    const dir = setupDir({});
    try {
      mockWs(sb, dir);
      assert.strictEqual(loadRoleAgentsMd('reviewer'), null);
    } finally { sb.restore(); fs.rmSync(dir, { recursive: true, force: true }); }
  });

  test('Разные роли — разные файлы', () => {
    invalidateRoleCache();
    const sb = sinon.createSandbox();
    const dir = setupDir({ '.llma/agents/coder.md': 'Кодер', '.llma/agents/reviewer.md': 'Ревьюер' });
    try {
      mockWs(sb, dir);
      assert.ok(loadRoleAgentsMd('coder')?.includes('Кодер'));
      assert.ok(loadRoleAgentsMd('reviewer')?.includes('Ревьюер'));
    } finally { sb.restore(); fs.rmSync(dir, { recursive: true, force: true }); }
  });

  test('Кеш: повторный вызов не читает файл', () => {
    invalidateRoleCache();
    const sb = sinon.createSandbox();
    const dir = setupDir({ '.llma/main.md': 'v1' });
    try {
      mockWs(sb, dir);
      const first = loadRoleAgentsMd('coder');
      fs.writeFileSync(path.join(dir, '.llma/main.md'), 'v2');
      assert.strictEqual(loadRoleAgentsMd('coder'), first);
    } finally { sb.restore(); fs.rmSync(dir, { recursive: true, force: true }); }
  });

  test('invalidateRoleCache сбрасывает кеш', () => {
    invalidateRoleCache();
    const sb = sinon.createSandbox();
    const dir = setupDir({ '.llma/main.md': 'v1' });
    try {
      mockWs(sb, dir);
      assert.ok(loadRoleAgentsMd('coder')?.includes('v1'));
      fs.writeFileSync(path.join(dir, '.llma/main.md'), 'v2');
      invalidateRoleCache();
      assert.ok(loadRoleAgentsMd('coder')?.includes('v2'));
    } finally { sb.restore(); fs.rmSync(dir, { recursive: true, force: true }); }
  });

  test('Нет workspace → null', () => {
    invalidateRoleCache();
    const sb = sinon.createSandbox();
    const vscode = require('vscode');
    sb.stub(vscode.workspace, 'workspaceFolders').value(undefined);
    try { assert.strictEqual(loadRoleAgentsMd('coder'), null); }
    finally { sb.restore(); }
  });

  test('Приоритет: .llma/agents/{role}.md > .llma/main.md', () => {
    invalidateRoleCache();
    const sb = sinon.createSandbox();
    const dir = setupDir({
      '.llma/agents/coder.md': 'Из ролевого',
      '.llma/main.md': 'Из главного',
    });
    try {
      mockWs(sb, dir);
      assert.ok(loadRoleAgentsMd('coder')?.includes('Из ролевого'));
    } finally { sb.restore(); fs.rmSync(dir, { recursive: true, force: true }); }
  });

  // --- SC-1..SC-6: Каталог скилов (.llma/skills/) ---

  test('SC-1: getSkillCatalog() возвращает каталог', () => {
    const dir = setupDir({
      '.llma/skills/coder.md': [
        '---',
        'role: coder',
        'description: Пишет код',
        '---',
        '',
        '# Роль',
      ].join('\n'),
      '.llma/skills/tester.md': [
        '---',
        'role: tester',
        'description: Тестирует',
        '---',
        '',
        '# Роль',
      ].join('\n'),
    });
    try {
      const catalog = getSkillCatalog(dir);
      assert.strictEqual(catalog.length, 2);
      assert.strictEqual(catalog[0].name, 'coder');
      assert.strictEqual(catalog[0].description, 'Пишет код');
      assert.strictEqual(catalog[1].name, 'tester');
    } finally { fs.rmSync(dir, { recursive: true, force: true }); }
  });

  test('SC-2: parseFrontmatter() — валидный frontmatter', () => {
    const result = parseFrontmatter([
      '---',
      'role: coder',
      'version: 1.0',
      'tools: [read_file]',
      'description: Dev',
      '---',
      '# Content',
    ].join('\n'));
    assert.strictEqual(result.role, 'coder');
    assert.strictEqual(result.version, '1.0');
    assert.strictEqual(result.tools, '[read_file]');
    assert.strictEqual(result.description, 'Dev');
  });

  test('SC-3: getSkillCatalog() — fallback без frontmatter', () => {
    const dir = setupDir({
      '.llma/skills/builder.md': 'Просто текст без frontmatter',
    });
    try {
      const catalog = getSkillCatalog(dir);
      assert.strictEqual(catalog.length, 1);
      assert.strictEqual(catalog[0].name, 'builder');
      assert.ok(catalog[0].description.includes('Просто текст'));
    } finally { fs.rmSync(dir, { recursive: true, force: true }); }
  });

  test('SC-5: getSkillTemplate() содержит таблицу скилов', () => {
    const dir = setupDir({
      '.llma/skills/coder.md': [
        '---',
        'role: coder',
        'description: Dev',
        '---',
        '# Role',
      ].join('\n'),
    });
    try {
      const tmpl = getSkillTemplate(dir);
      assert.ok(tmpl.includes('## Доступные скилы'));
      assert.ok(tmpl.includes('| coder | Dev |'));
      assert.ok(tmpl.includes('Структура скила'));
    } finally { fs.rmSync(dir, { recursive: true, force: true }); }
  });

  test('SC-6: getSkillTemplate() без скилов — без секции', () => {
    const dir = setupDir({});
    try {
      const tmpl = getSkillTemplate(dir);
      assert.ok(tmpl.includes('Структура скила'));
      assert.ok(!tmpl.includes('Доступные скилы'));
    } finally { fs.rmSync(dir, { recursive: true, force: true }); }
  });

  test('SC-6: getSkillTemplate() без workspace — без секции', () => {
    const tmpl = getSkillTemplate();
    assert.ok(tmpl.includes('Структура скила'));
    assert.ok(!tmpl.includes('Доступные скилы'));
  });
});
