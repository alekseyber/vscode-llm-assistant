// Тесты для RoleAgentsMdLoader — .llma/agents/{role}.md и .llma/main.md (MA-5)
import 'mocha';
import * as assert from 'assert';
import * as path from 'path';
import * as fs from 'fs';
import * as os from 'os';
import * as sinon from 'sinon';
import { loadRoleAgentsMd, invalidateRoleCache } from '../../src/shared/RoleAgentsMdLoader';

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
});
