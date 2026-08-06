// Тесты для RoleAgentsMdLoader — Role-based AGENTS.md (MA-5)
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
    const filePath = path.join(dir, name);
    fs.mkdirSync(path.dirname(filePath), { recursive: true });
    fs.writeFileSync(filePath, content);
  }
  return dir;
}

function mockWs(sb: sinon.SinonSandbox, dir: string): void {
  const vscode = require('vscode');
  sb.stub(vscode.workspace, 'workspaceFolders').value([{ uri: { fsPath: dir } }]);
}

suite('RoleAgentsMdLoader', () => {
  test('MA-5.1: AGENTS.coder.md загружается для роли coder', () => {
    invalidateRoleCache();
    const sb = sinon.createSandbox();
    const dir = setupDir({ 'AGENTS.coder.md': 'Пиши чистый код', 'AGENTS.md': 'Общие' });
    try {
      mockWs(sb, dir);
      const c = loadRoleAgentsMd('coder');
      assert.ok(c?.includes('Пиши чистый код'));
    } finally { sb.restore(); fs.rmSync(dir, { recursive: true, force: true }); }
  });

  test('MA-5.2: fallback на AGENTS.md если ролевого нет', () => {
    invalidateRoleCache();
    const sb = sinon.createSandbox();
    const dir = setupDir({ 'AGENTS.md': 'Общие правила' });
    try {
      mockWs(sb, dir);
      assert.ok(loadRoleAgentsMd('coder')?.includes('Общие правила'));
    } finally { sb.restore(); fs.rmSync(dir, { recursive: true, force: true }); }
  });

  test('MA-5.2: null если нет файлов', () => {
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
    const dir = setupDir({ 'AGENTS.coder.md': 'Кодер', 'AGENTS.reviewer.md': 'Ревьюер' });
    try {
      mockWs(sb, dir);
      assert.ok(loadRoleAgentsMd('coder')?.includes('Кодер'));
      assert.ok(loadRoleAgentsMd('reviewer')?.includes('Ревьюер'));
    } finally { sb.restore(); fs.rmSync(dir, { recursive: true, force: true }); }
  });

  test('Кеш: повторный вызов не читает файл', () => {
    invalidateRoleCache();
    const sb = sinon.createSandbox();
    const dir = setupDir({ 'AGENTS.tester.md': 'v1' });
    try {
      mockWs(sb, dir);
      const first = loadRoleAgentsMd('tester');
      fs.writeFileSync(path.join(dir, 'AGENTS.tester.md'), 'v2');
      assert.strictEqual(loadRoleAgentsMd('tester'), first);
    } finally { sb.restore(); fs.rmSync(dir, { recursive: true, force: true }); }
  });

  test('invalidateRoleCache сбрасывает кеш', () => {
    invalidateRoleCache();
    const sb = sinon.createSandbox();
    const dir = setupDir({ 'AGENTS.dev.md': 'v1' });
    try {
      mockWs(sb, dir);
      assert.ok(loadRoleAgentsMd('dev')?.includes('v1'));
      fs.writeFileSync(path.join(dir, 'AGENTS.dev.md'), 'v2');
      invalidateRoleCache();
      assert.ok(loadRoleAgentsMd('dev')?.includes('v2'));
    } finally { sb.restore(); fs.rmSync(dir, { recursive: true, force: true }); }
  });

  test('Пустой AGENTS.role.md → fallback', () => {
    invalidateRoleCache();
    const sb = sinon.createSandbox();
    const dir = setupDir({ 'AGENTS.coder.md': '', 'AGENTS.md': 'Общие' });
    try {
      mockWs(sb, dir);
      assert.ok(loadRoleAgentsMd('coder')?.includes('Общие'));
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

  test('.llma/agents/{role}.md — приоритет над AGENTS.{role}.md', () => {
    invalidateRoleCache();
    const sb = sinon.createSandbox();
    const dir = setupDir({
      '.llma/agents/coder.md': 'Из .llma',
      'AGENTS.coder.md': 'Из корня',
    });
    try {
      mockWs(sb, dir);
      const c = loadRoleAgentsMd('coder');
      assert.ok(c?.includes('Из .llma'), 'Должен загрузить из .llma/agents/');
    } finally { sb.restore(); fs.rmSync(dir, { recursive: true, force: true }); }
  });
});
