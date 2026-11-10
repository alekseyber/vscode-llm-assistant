// E2E-12: правила проекта из трёх источников — порядок, лимит и отчёт команды.
// Работает на настоящей ФС рабочего пространства (копия test/fixtures/e2e-workspace):
// файлы создаются в корне, читаются реальным загрузчиком, а не фикстурой в памяти.

import 'mocha';
import * as assert from 'assert';
import * as fs from 'fs';
import * as path from 'path';
import * as vscode from 'vscode';
import { loadAgentsMd, buildRulesReport } from '../../../src/shared/AgentsMdLoader';
import { applySettings, SettingsSnapshot } from './helpers/settings';

/** Корень рабочего пространства, а не каталог репозитория: e2e открывает копию фикстуры. */
function workspaceRoot(): string {
  const folder = (vscode.workspace.workspaceFolders ?? [])[0];
  assert.ok(folder, 'рабочее пространство открыто');
  return folder!.uri.fsPath;
}

suite('E2E-12: источники правил проекта', () => {
  let snap: SettingsSnapshot | undefined;
  let root: string;
  let llmaMain: string;
  let claudeMd: string;
  let createdLlmaDir = false;

  setup(async () => {
    root = workspaceRoot();
    llmaMain = path.join(root, '.llma', 'main.md');
    claudeMd = path.join(root, 'CLAUDE.md');
    createdLlmaDir = !fs.existsSync(path.join(root, '.llma'));
    // Файлов .llma/main.md и CLAUDE.md в фикстуре нет: создаём и убираем за собой
    fs.mkdirSync(path.join(root, '.llma'), { recursive: true });
    fs.writeFileSync(llmaMain, '# Правила плагина\nE2E-LLMA-MAIN-MARKER\n', 'utf-8');
    fs.writeFileSync(claudeMd, '# Правила Claude Code\nE2E-CLAUDE-MARKER\n', 'utf-8');
    // Активный редактор в корне: загрузчик берёт корень активного редактора
    await vscode.window.showTextDocument(vscode.Uri.file(path.join(root, 'README.md')));
    snap = await applySettings({ 'agentsMd.enabled': true });
  });

  teardown(async () => {
    await snap?.restore();
    snap = undefined;
    try {
      fs.rmSync(claudeMd, { force: true });
      fs.rmSync(llmaMain, { force: true });
      if (createdLlmaDir) fs.rmSync(path.join(root, '.llma'), { recursive: true, force: true });
    } catch {
      /* нечего удалять — не повод валить teardown */
    }
  });

  test('E2E-12a: порядок AGENTS.md → .llma/main.md → CLAUDE.md и все три в промпте', async function () {
    this.timeout(20000);
    const merged = await loadAgentsMd();
    assert.ok(merged, 'правила собраны');

    const headers = ['### Источник: AGENTS.md', '### Источник: .llma/main.md', '### Источник: CLAUDE.md'];
    const positions = headers.map((header) => {
      const index = merged!.indexOf(header);
      assert.ok(index >= 0, `секция «${header}» есть в промпте:\n${merged}`);
      return index;
    });
    assert.ok(
      positions[0] < positions[1] && positions[1] < positions[2],
      `порядок источников сохранён: ${positions.join(' < ')}`,
    );

    // Содержимое берётся из файлов на диске, а не из кеша прошлой сессии
    assert.ok(merged!.includes('E2E-AGENTS-MARKER'), 'текст AGENTS.md в промпте');
    assert.ok(merged!.includes('E2E-LLMA-MAIN-MARKER'), 'текст .llma/main.md в промпте');
    assert.ok(merged!.includes('E2E-CLAUDE-MARKER'), 'текст CLAUDE.md в промпте');
  });

  test('E2E-12b: agentsMd.maxChars применяется без перезапуска и помечает обрезку', async function () {
    this.timeout(20000);
    const full = await loadAgentsMd();
    assert.ok(full && full.includes('E2E-CLAUDE-MARKER'), 'при дефолтном лимите доходит до третьего источника');

    // Смена настройки должна применяться сразу: лимит входит в ключ кеша (дефект ревью P7)
    snap = await applySettings({ 'agentsMd.maxChars': 300 });
    const limited = await loadAgentsMd();
    assert.ok(limited, 'правила собраны при малом лимите');
    assert.ok(!limited!.includes('E2E-CLAUDE-MARKER'), 'третий источник отрезан лимитом');
    assert.ok(limited!.length <= 320, `в промпт ушло не больше лимита плюс запас: ${limited!.length}`);

    const report = await buildRulesReport();
    assert.ok(/обрезано лимитом/.test(report), `отчёт помечает обрезку:\n${report}`);
    assert.ok(/лимит: 300 знаков/.test(report), 'в отчёте виден действующий лимит');
  });

  test('E2E-12c: команда «Показать источники правил» отрабатывает и перечисляет файлы', async function () {
    this.timeout(20000);
    const report = await buildRulesReport();
    for (const file of ['AGENTS.md', '.llma/main.md', 'CLAUDE.md']) {
      assert.ok(report.includes(file), `в отчёте есть ${file}:\n${report}`);
    }
    // Диагностика не должна падать сама — иначе её нельзя использовать при разборе
    await vscode.commands.executeCommand('llmAssistant.showRulesSources');
  });
});
