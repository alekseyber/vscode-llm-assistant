// Тесты для RoleAgentsMdLoader — .llma/agents/{role}.md и .llma/main.md (MA-5)
import 'mocha';
import * as assert from 'assert';
import * as path from 'path';
import * as fs from 'fs';
import * as os from 'os';
import * as sinon from 'sinon';
import { loadRoleAgentsMd, loadAllAgentRoles, loadOrchestratorRoles, loadClaudeAgentRoles, invalidateRoleCache, parseFrontmatter, getSkillCatalog, getSkillTemplate, loadSkillMd } from '../../src/shared/RoleAgentsMdLoader';

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
        'name: coder',
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

  test('CLS-1: скил из .claude/skills/<имя>/SKILL.md попадает в каталог с путём', () => {
    const dir = setupDir({
      '.claude/skills/reviewer/SKILL.md': [
        '---',
        'name: reviewer',
        'description: Проверяет код по чек-листу',
        '---',
        '',
        '# Reviewer',
      ].join('\n'),
    });
    try {
      const catalog = getSkillCatalog(dir);
      assert.strictEqual(catalog.length, 1);
      assert.strictEqual(catalog[0].name, 'reviewer');
      assert.strictEqual(catalog[0].path, '.claude/skills/reviewer/SKILL.md', 'агент должен знать, что читать');
      assert.match(catalog[0].description, /Проверяет код/);
    } finally { fs.rmSync(dir, { recursive: true, force: true }); }
  });

  test('CLS-2: одно имя в двух каталогах — приоритет у .llma, дубля нет', () => {
    const dir = setupDir({
      '.llma/skills/coder.md': ['---', 'name: coder', 'description: Из .llma', '---', '# Role'].join('\n'),
      '.claude/skills/coder/SKILL.md': ['---', 'name: coder', 'description: Из .claude', '---', '# Role'].join('\n'),
    });
    try {
      const catalog = getSkillCatalog(dir);
      assert.strictEqual(catalog.length, 1, 'дубль не должен попадать в каталог');
      assert.strictEqual(catalog[0].path, '.llma/skills/coder.md');
      assert.match(catalog[0].description, /Из \.llma/);
    } finally { fs.rmSync(dir, { recursive: true, force: true }); }
  });

  test('CLS-3: битый frontmatter в .claude — имя из каталога, без падения', () => {
    const dir = setupDir({
      '.claude/skills/broken/SKILL.md': ['---', 'name: [не yaml', '---', 'Текст инструкции'].join('\n'),
    });
    try {
      const catalog = getSkillCatalog(dir);
      assert.strictEqual(catalog.length, 1);
      assert.strictEqual(catalog[0].name, 'broken', 'запасное имя — имя каталога');
      assert.match(catalog[0].description, /Текст инструкции/);
    } finally { fs.rmSync(dir, { recursive: true, force: true }); }
  });

  test('CLS-4: каталог обрезается лимитом и говорит об этом', () => {
    const files: Record<string, string> = {};
    for (let i = 0; i < 120; i += 1) {
      files[`.llma/skills/skill-${i}.md`] = ['---', `name: skill-${i}`, `description: ${'описание '.repeat(8)}`, '---'].join('\n');
    }
    const dir = setupDir(files);
    try {
      const template = getSkillTemplate(dir);
      assert.match(template, /каталог обрезан лимитом/);
      assert.ok(template.length < 9000, `промпт не раздут каталогом (${template.length})`);
    } finally { fs.rmSync(dir, { recursive: true, force: true }); }
  });

  test('CLS-5: порядок каталога детерминирован, `|` в описании не ломает таблицу', () => {
    const dir = setupDir({
      '.llma/skills/zeta.md': ['---', 'name: zeta', 'description: a | b', '---'].join('\n'),
      '.llma/skills/alpha.md': ['---', 'name: alpha', 'description: первая', '---'].join('\n'),
    });
    try {
      const catalog = getSkillCatalog(dir);
      assert.deepStrictEqual(catalog.map((s) => s.name), ['alpha', 'zeta'], 'порядок по имени, а не по readdir');
      const template = getSkillTemplate(dir);
      assert.match(template, /a \\?\| b/, 'вертикальная черта экранирована');
    } finally { fs.rmSync(dir, { recursive: true, force: true }); }
  });

  test('CLS-6: loadSkillMd находит скил по имени из frontmatter и отвергает ../', () => {
    const sb = sinon.createSandbox();
    const dir = setupDir({
      '.claude/skills/reviewer-dir/SKILL.md': ['---', 'name: reviewer', 'description: Проверка', '---', 'ТЕЛО СКИЛА'].join('\n'),
    });
    try {
      mockWs(sb, dir);
      assert.match(String(loadSkillMd('reviewer')), /ТЕЛО СКИЛА/, 'имя из frontmatter, не имя каталога');
      assert.strictEqual(loadSkillMd('../etc/passwd'), null, 'выход за пределы workspace запрещён');
    } finally { sb.restore(); fs.rmSync(dir, { recursive: true, force: true }); }
  });

  test('CLS-7: незакрытый frontmatter не попадает в описание', () => {
    const dir = setupDir({
      '.claude/skills/broken/SKILL.md': ['---', 'name: broken', 'Инструкция без закрывающего блока'].join('\n'),
    });
    try {
      const catalog = getSkillCatalog(dir);
      assert.strictEqual(catalog.length, 1);
      assert.doesNotMatch(catalog[0].description, /name: broken/, 'служебные строки вырезаны');
      assert.match(catalog[0].description, /Инструкция/);
    } finally { fs.rmSync(dir, { recursive: true, force: true }); }
  });

  test('CLA-1: роль из .claude/agents — name/description/тело, tools фильтруются allowlist', () => {
    const dir = setupDir({
      '.claude/agents/reviewer.md': [
        '---',
        'name: reviewer',
        'description: Проверяет код',
        'tools: [read_file, search_files, rm_rf, mcp_evil_tool]',
        '---',
        'Ты проверяешь код по чек-листу.',
      ].join('\n'),
    });
    try {
      const roles = loadClaudeAgentRoles(dir);
      assert.strictEqual(roles.length, 1);
      assert.strictEqual(roles[0].name, 'reviewer');
      assert.strictEqual(roles[0].description, 'Проверяет код', 'описание хранится отдельно, не в промпте');
      assert.match(roles[0].systemPrompt, /чек-листу/);
      assert.doesNotMatch(roles[0].systemPrompt, /Проверяет код/, 'UI-подпись не уходит в системный промпт');
      assert.deepStrictEqual(roles[0].allowedTools, ['read_file', 'search_files'], 'незнакомые инструменты отброшены');
    } finally { fs.rmSync(dir, { recursive: true, force: true }); }
  });

  test('CLA-4: `tools: []` — явный запрет инструментов, а не «все доступны»', () => {
    const dir = setupDir({
      '.claude/agents/reader.md': ['---', 'name: reader', 'tools: []', '---', 'Только читай'].join('\n'),
      '.claude/agents/free.md': ['---', 'name: free', '---', 'Делай что хочешь'].join('\n'),
    });
    try {
      const roles = loadClaudeAgentRoles(dir);
      const reader = roles.find((r) => r.name === 'reader')!;
      const free = roles.find((r) => r.name === 'free')!;
      assert.deepStrictEqual(reader.allowedTools, [], 'пустой список — запрет всего');
      assert.strictEqual(free.allowedTools, undefined, 'поле не задано — без ограничений');
    } finally { fs.rmSync(dir, { recursive: true, force: true }); }
  });

  test('CLA-5: два файла с одним именем в .claude — одна роль', () => {
    const dir = setupDir({
      '.claude/agents/a-first.md': ['---', 'name: reviewer', '---', 'Первый'].join('\n'),
      '.claude/agents/b-second.md': ['---', 'name: reviewer', '---', 'Второй'].join('\n'),
    });
    try {
      const roles = loadClaudeAgentRoles(dir);
      assert.strictEqual(roles.length, 1, 'дубль по имени отброшен');
      assert.match(roles[0].systemPrompt, /Первый/);
    } finally { fs.rmSync(dir, { recursive: true, force: true }); }
  });

  test('CLA-2: конфликт имён — приоритет у .llma/agents', () => {
    const sb = sinon.createSandbox();
    const dir = setupDir({
      '.llma/agents/coder.md': 'Свой кодер',
      '.claude/agents/coder.md': ['---', 'name: coder', '---', 'Чужой кодер'].join('\n'),
      '.claude/agents/architect.md': ['---', 'name: architect', '---', 'Чужой архитектор'].join('\n'),
    });
    try {
      mockWs(sb, dir);
      const roles = loadAllAgentRoles();
      const coders = roles.filter((r) => r.name === 'coder');
      assert.strictEqual(coders.length, 1, 'роль не дублируется');
      assert.match(coders[0].systemPrompt, /Свой кодер/, 'осталась своя роль');
      assert.ok(roles.some((r) => r.name === 'architect' && /Чужой архитектор/.test(r.systemPrompt)), 'новая роль добавлена');
    } finally { sb.restore(); fs.rmSync(dir, { recursive: true, force: true }); }
  });

  test('CLA-3: без .llma/agents оркестрация берётся из .claude, битое имя — из файла', () => {
    const sb = sinon.createSandbox();
    const dir = setupDir({
      '.claude/agents/02-impl.md': ['---', 'name: [битое', '---', 'Пиши код'].join('\n'),
    });
    try {
      mockWs(sb, dir);
      const roles = loadOrchestratorRoles();
      assert.strictEqual(roles.length, 1);
      assert.strictEqual(roles[0].name, '02-impl', 'запасное имя — имя файла');
      assert.match(roles[0].systemPrompt, /Пиши код/);
    } finally { sb.restore(); fs.rmSync(dir, { recursive: true, force: true }); }
  });

  test('SC-2: parseFrontmatter() — валидный frontmatter', () => {
    // name (приоритетный)
    const r1 = parseFrontmatter(['---', 'name: coder', 'version: 1.0', 'description: Dev', '---', '# Content'].join('\n'));
    assert.strictEqual(r1.name, 'coder');
    assert.strictEqual(r1.description, 'Dev');
    // role (обратная совместимость)
    const r2 = parseFrontmatter(['---', 'role: builder', 'version: 1.0', 'description: Build', '---', '# Content'].join('\n'));
    assert.strictEqual(r2.role, 'builder');
    assert.strictEqual(r2.description, 'Build');
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
        'name: coder',
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
