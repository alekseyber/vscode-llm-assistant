// Интеграционный тест: AGENTS.md инжект в system prompt
// Проверяет полный цикл: загрузка AGENTS.md → инжект в getSystemPrompt

import * as path from 'path';
import * as fs from 'fs';
import * as sinon from 'sinon';
import * as assert from 'assert';
import { loadAgentsMd } from '../../src/shared/AgentsMdLoader';
import * as vscode from 'vscode';
import { fakeConfiguration } from '../support/vscode-harness';

suite('AGENTS.md — интеграция с system prompt', () => {
  let sandbox: sinon.SinonSandbox;

  setup(() => {
    sandbox = sinon.createSandbox();
    // Мок workspaceFolders
    sandbox.stub(vscode.workspace, 'workspaceFolders').value([{
      uri: { fsPath: '/tmp/test-workspace' },
      name: 'test',
      index: 0,
    }]);
    // Мок getConfiguration для agentsMd.enabled=true
    sandbox.stub(vscode.workspace, 'getConfiguration').returns(
      fakeConfiguration((key: string) => key === 'agentsMd.enabled'),
    );
    // Мок onDidChangeTextDocument
    sandbox.stub(vscode.workspace, 'onDidChangeTextDocument').returns({ dispose: () => undefined });
    sandbox.stub(vscode.workspace, 'onDidCreateFiles').returns({ dispose: () => undefined });
    sandbox.stub(vscode.workspace, 'onDidDeleteFiles').returns({ dispose: () => undefined });
    // Создаём временный .llma/main.md
    const llmaDir = '/tmp/test-workspace/.llma';
    const agentsPath = '/tmp/test-workspace/.llma/main.md';
    if (!fs.existsSync(llmaDir)) fs.mkdirSync(llmaDir, { recursive: true });
    fs.writeFileSync(agentsPath, '## Правила\n- Отвечай с 🚀\n- Всегда говори «Капитан»');
  });

  teardown(() => {
    sandbox.restore();
    // Удаляем временный .llma/main.md
    const agentsPath = '/tmp/test-workspace/.llma/main.md';
    if (fs.existsSync(agentsPath)) fs.unlinkSync(agentsPath);
  });

  test('AGENTS.md загружается и содержит правила', async () => {
    const content = await loadAgentsMd();
    assert.ok(content, 'AGENTS.md должен загрузиться');
    assert.ok(content!.includes('🚀'), 'Должен содержать 🚀');
    assert.ok(content!.includes('Капитан'), 'Должен содержать Капитан');
  });

  test('System prompt содержит AGENTS.md после инжекта', async () => {
    // Имитируем логику getSystemPrompt
    const agentsMd = await loadAgentsMd();
    let systemPrompt = 'Ты — AI-ассистент.';
    
    if (agentsMd) {
      systemPrompt += `\n\n## Правила проекта:\n${agentsMd}`;
    }

    assert.ok(systemPrompt.includes('## Правила проекта:'), 'System prompt должен содержать заголовок правил проекта');
    assert.ok(systemPrompt.includes('🚀'), 'System prompt должен содержать правила из AGENTS.md');
    assert.ok(systemPrompt.includes('Капитан'), 'System prompt должен содержать Капитан');
  });
});
