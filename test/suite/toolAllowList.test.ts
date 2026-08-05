// Тесты для ToolAllowList — фильтрация инструментов по allow-list (слой 02 Tool Contracts)
// Проверяет: фильтрацию getAllowedTools, isConfirmationRequired,
// загрузку конфига из workspace .vscode/llm-assistant.json и глобальных настроек

import 'mocha';
import * as sinon from 'sinon';
import * as vscode from 'vscode';
import * as assert from 'assert';
import * as path from 'path';
import * as os from 'os';
import * as fs from 'fs/promises';
import {
  getAllowedTools,
  isConfirmationRequired,
  loadToolAllowListConfig,
  ToolAllowListConfig,
  ALL_TOOL_NAMES,
  DEFAULT_CONFIG,
} from '../../src/modes/apply/ToolAllowList';

/** Тестовый тип инструмента */
interface TestTool {
  name: string;
  description: string;
}

/** Создать список всех тестовых инструментов */
function createAllTestTools(): TestTool[] {
  return [
    { name: 'read_file', description: 'Чтение файла' },
    { name: 'write_file', description: 'Запись файла' },
    { name: 'replace_in_file', description: 'Замена в файле' },
    { name: 'list_files', description: 'Список файлов' },
    { name: 'search_files', description: 'Поиск' },
    { name: 'run_terminal', description: 'Терминал' },
  ];
}

suite('ToolAllowList — getAllowedTools', () => {
  const allTools = createAllTestTools();

  // ── AC-4.1: allowedTools: ["read_file"] → только read_file ──
  test('AC-4.1: allowedTools: ["read_file"] — агент видит только read_file', () => {
    const config: ToolAllowListConfig = { allowedTools: ['read_file'] };
    const filtered = getAllowedTools(allTools, config);

    assert.strictEqual(filtered.length, 1, 'Должен остаться ровно 1 инструмент');
    assert.strictEqual(filtered[0].name, 'read_file', 'Единственный инструмент — read_file');
  });

  // ── AC-4.2: allowedTools не указан → все инструменты доступны ──
  test('AC-4.2: allowedTools не указан — все инструменты доступны (обратная совместимость)', () => {
    const config1: ToolAllowListConfig = {};
    const filtered1 = getAllowedTools(allTools, config1);
    assert.strictEqual(filtered1.length, allTools.length, 'Без allowedTools — все инструменты');

    const config2: ToolAllowListConfig = { allowedTools: [] };
    const filtered2 = getAllowedTools(allTools, config2);
    assert.strictEqual(filtered2.length, allTools.length, 'Пустой allowedTools — все инструменты');
  });

  // ── allowedTools: несколько инструментов ──
  test('allowedTools с несколькими инструментами — возвращает только указанные', () => {
    const config: ToolAllowListConfig = { allowedTools: ['read_file', 'search_files', 'list_files'] };
    const filtered = getAllowedTools(allTools, config);

    assert.strictEqual(filtered.length, 3);
    const names = filtered.map((t) => t.name).sort();
    assert.deepStrictEqual(names, ['list_files', 'read_file', 'search_files']);
  });

  // ── allowedTools с несуществующим именем — игнорируется ──
  test('allowedTools с несуществующим именем инструмента — игнорируется', () => {
    const config: ToolAllowListConfig = { allowedTools: ['read_file', 'nonexistent'] };
    const filtered = getAllowedTools(allTools, config);

    assert.strictEqual(filtered.length, 1, 'Только существующий инструмент');
    assert.strictEqual(filtered[0].name, 'read_file');
  });

  // ── allowedTools: ни одного совпадения → пустой массив ──
  test('allowedTools без совпадений — возвращает пустой массив', () => {
    const config: ToolAllowListConfig = { allowedTools: ['nonexistent1', 'nonexistent2'] };
    const filtered = getAllowedTools(allTools, config);

    assert.strictEqual(filtered.length, 0, 'Пустой результат при отсутствии совпадений');
  });

  // ── Не мутирует исходный массив ──
  test('getAllowedTools не мутирует исходный массив', () => {
    const original = createAllTestTools();
    const originalLength = original.length;

    const config: ToolAllowListConfig = { allowedTools: ['read_file'] };
    getAllowedTools(original, config);

    assert.strictEqual(original.length, originalLength, 'Исходный массив не изменён');
  });
});

suite('ToolAllowList — isConfirmationRequired', () => {
  // ── AC-4.4: инструменты из requireConfirmation требуют подтверждения ──
  test('AC-4.4: write_file из списка requireConfirmation — требует подтверждения', () => {
    const config: ToolAllowListConfig = { requireConfirmation: ['write_file', 'replace_in_file', 'run_terminal'] };

    assert.strictEqual(isConfirmationRequired('write_file', config), true);
    assert.strictEqual(isConfirmationRequired('replace_in_file', config), true);
    assert.strictEqual(isConfirmationRequired('run_terminal', config), true);
  });

  // ── read-only инструменты НЕ требуют подтверждения ──
  test('read_file НЕ требует подтверждения', () => {
    const config: ToolAllowListConfig = { requireConfirmation: ['write_file', 'run_terminal'] };

    assert.strictEqual(isConfirmationRequired('read_file', config), false);
    assert.strictEqual(isConfirmationRequired('search_files', config), false);
    assert.strictEqual(isConfirmationRequired('list_files', config), false);
  });

  // ── Пустой requireConfirmation — никто не требует ──
  test('Пустой requireConfirmation — ни один инструмент не требует подтверждения', () => {
    assert.strictEqual(isConfirmationRequired('write_file', { requireConfirmation: [] }), false);
    assert.strictEqual(isConfirmationRequired('run_terminal', { requireConfirmation: [] }), false);
  });

  // ── Без requireConfirmation — никто не требует ──
  test('Без поля requireConfirmation — ни один инструмент не требует подтверждения', () => {
    assert.strictEqual(isConfirmationRequired('write_file', {}), false);
    assert.strictEqual(isConfirmationRequired('run_terminal', {}), false);
  });

  // ── Несуществующий инструмент ──
  test('Несуществующий инструмент — false', () => {
    const config: ToolAllowListConfig = { requireConfirmation: ['write_file'] };
    assert.strictEqual(isConfirmationRequired('nonexistent', config), false);
  });
});

suite('ToolAllowList — DEFAULT_CONFIG', () => {
  test('DEFAULT_CONFIG.requireConfirmation содержит опасные инструменты', () => {
    assert.ok(DEFAULT_CONFIG.requireConfirmation);
    const required = DEFAULT_CONFIG.requireConfirmation!;
    assert.ok(required.includes('write_file'), 'write_file должен требовать подтверждения');
    assert.ok(required.includes('replace_in_file'), 'replace_in_file должен требовать подтверждения');
    assert.ok(required.includes('run_terminal'), 'run_terminal должен требовать подтверждения');
  });

  test('ALL_TOOL_NAMES содержит все 7 инструментов', () => {
    assert.deepStrictEqual(
      [...ALL_TOOL_NAMES].sort(),
      ['list_files', 'read_file', 'replace_in_file', 'run_terminal', 'search_files', 'write_file', 'patch_file'].sort(),
    );
  });
});

/**
 * Интеграционные тесты: загрузка конфига из .vscode/llm-assistant.json
 * и глобальных настроек VS Code.
 */
suite('ToolAllowList — loadToolAllowListConfig (интеграция)', () => {
  let sandbox: sinon.SinonSandbox;
  let tempDir: string;
  let vscodeDir: string;

  setup(async () => {
    sandbox = sinon.createSandbox();
    tempDir = path.join(os.tmpdir(), `vscode-llm-test-al-${Date.now()}`);
    vscodeDir = path.join(tempDir, '.vscode');
    await fs.mkdir(vscodeDir, { recursive: true });
  });

  teardown(async () => {
    sandbox.restore();
    try { await fs.rm(tempDir, { recursive: true, force: true }); } catch { /* ok */ }
  });

  /** Настроить мок workspace с нужной папкой и настройками */
  function mockWorkspace(
    workspacePath: string,
    allowedTools?: string[],
    requireConfirmation?: string[],
  ): void {
    sandbox.stub(vscode.workspace, 'workspaceFolders').value([
      { uri: vscode.Uri.file(workspacePath), name: 'test', index: 0 },
    ]);

    const mockConfig = {
      get: sandbox.fake((key: string, defaultValue?: unknown) => {
        if (key === 'apply.allowedTools') return allowedTools ?? defaultValue;
        if (key === 'apply.requireConfirmation') return requireConfirmation ?? defaultValue;
        if (key === 'agentsMd.enabled') return true;
        return defaultValue;
      }),
      has: sandbox.fake(() => false),
      inspect: sandbox.fake(() => undefined),
      update: sandbox.fake(() => Promise.resolve()),
    };
    sandbox.stub(vscode.workspace, 'getConfiguration').returns(mockConfig as any);
  }

  // ── AC-4.3: .vscode/llm-assistant.json переопределяет глобальные настройки ──
  test('AC-4.3: .vscode/llm-assistant.json переопределяет глобальные настройки', async () => {
    // Создаём workspace-конфиг с ограниченным списком
    const workspaceConfig = {
      allowedTools: ['read_file', 'search_files'],
      requireConfirmation: ['run_terminal'],
    };
    await fs.writeFile(
      path.join(vscodeDir, 'llm-assistant.json'),
      JSON.stringify(workspaceConfig),
      'utf-8',
    );

    // Глобальные настройки: все инструменты
    mockWorkspace(tempDir, undefined, ['write_file', 'replace_in_file', 'run_terminal']);

    const config = loadToolAllowListConfig();

    // Workspace-конфиг должен иметь приоритет
    assert.deepStrictEqual(config.allowedTools, ['read_file', 'search_files']);
    assert.deepStrictEqual(config.requireConfirmation, ['run_terminal']);
  });

  // ── Если .vscode/llm-assistant.json нет — используются глобальные настройки ──
  test('Без .vscode/llm-assistant.json — используются глобальные настройки', async () => {
    // Файл НЕ создаём
    mockWorkspace(tempDir, ['read_file', 'write_file'], ['write_file', 'run_terminal']);

    const config = loadToolAllowListConfig();

    assert.deepStrictEqual(config.allowedTools, ['read_file', 'write_file']);
    assert.deepStrictEqual(config.requireConfirmation, ['write_file', 'run_terminal']);
  });

  // ── Невалидный JSON → fallback на глобальные ──
  test('Невалидный .vscode/llm-assistant.json — fallback на глобальные настройки', async () => {
    await fs.writeFile(
      path.join(vscodeDir, 'llm-assistant.json'),
      '{ invalid json }',
      'utf-8',
    );

    mockWorkspace(tempDir, ['read_file'], ['run_terminal']);

    const config = loadToolAllowListConfig();

    // Должны использоваться глобальные настройки
    assert.deepStrictEqual(config.allowedTools, ['read_file']);
    assert.deepStrictEqual(config.requireConfirmation, ['run_terminal']);
  });

  // ── Нет workspace → глобальные настройки ──
  test('Нет workspace — используются глобальные настройки', () => {
    sandbox.stub(vscode.workspace, 'workspaceFolders').value(undefined);

    const mockConfig = {
      get: sandbox.fake((key: string, defaultValue?: unknown) => {
        if (key === 'apply.allowedTools') return ['search_files'];
        if (key === 'apply.requireConfirmation') return ['write_file'];
        return defaultValue;
      }),
      has: sandbox.fake(() => false),
      inspect: sandbox.fake(() => undefined),
      update: sandbox.fake(() => Promise.resolve()),
    };
    sandbox.stub(vscode.workspace, 'getConfiguration').returns(mockConfig as any);

    const config = loadToolAllowListConfig();

    assert.deepStrictEqual(config.allowedTools, ['search_files']);
    assert.deepStrictEqual(config.requireConfirmation, ['write_file']);
  });

  // ── Дефолтные значения когда ничего не настроено ──
  test('Ничего не настроено — allowedTools undefined, requireConfirmation = default', () => {
    sandbox.stub(vscode.workspace, 'workspaceFolders').value(undefined);

    const mockConfig = {
      get: sandbox.fake((_key: string, defaultValue?: unknown) => defaultValue),
      has: sandbox.fake(() => false),
      inspect: sandbox.fake(() => undefined),
      update: sandbox.fake(() => Promise.resolve()),
    };
    sandbox.stub(vscode.workspace, 'getConfiguration').returns(mockConfig as any);

    const config = loadToolAllowListConfig();

    assert.strictEqual(config.allowedTools, undefined);
    assert.deepStrictEqual(
      config.requireConfirmation,
      ['write_file', 'replace_in_file', 'run_terminal'],
    );
  });

  // ── Workspace-конфиг с частичными данными ──
  test('.vscode/llm-assistant.json только с allowedTools — requireConfirmation из дефолта', async () => {
    await fs.writeFile(
      path.join(vscodeDir, 'llm-assistant.json'),
      JSON.stringify({ allowedTools: ['read_file', 'list_files'] }),
      'utf-8',
    );

    mockWorkspace(tempDir, undefined, ['run_terminal']);

    const config = loadToolAllowListConfig();

    assert.deepStrictEqual(config.allowedTools, ['read_file', 'list_files']);
    // requireConfirmation из дефолта (глобальные игнорируются при наличии workspace-конфига)
    assert.deepStrictEqual(
      config.requireConfirmation,
      ['write_file', 'replace_in_file', 'run_terminal'],
    );
  });
});
