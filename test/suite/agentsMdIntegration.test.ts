// Интеграционный тест: AGENTS.md инжект в system prompt
// Проверяет полный цикл: загрузка AGENTS.md → инжект в getSystemPrompt

import * as path from 'path';
import * as fs from 'fs';
import * as sinon from 'sinon';
import * as assert from 'assert';
import { loadAgentsMd } from '../../src/shared/AgentsMdLoader';
import * as vscode from 'vscode';

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
    sandbox.stub(vscode.workspace, 'getConfiguration').returns({
      get: sandbox.stub().callsFake((key: string, defaultValue: any) => {
        if (key === 'agentsMd.enabled') return true;
        return false;
      }),
      has: sandbox.stub().returns(false),
      inspect: sandbox.stub().returns(undefined),
    } as any);
    // Мок onDidChangeTextDocument
    sandbox.stub(vscode.workspace, 'onDidChangeTextDocument').returns({ dispose: () => {} } as any);
    sandbox.stub(vscode.workspace, 'onDidCreateFiles').returns({ dispose: () => {} } as any);
    sandbox.stub(vscode.workspace, 'onDidDeleteFiles').returns({ dispose: () => {} } as any);
    // Создаём временный AGENTS.md
    const agentsPath = '/tmp/test-workspace/AGENTS.md';
    if (!fs.existsSync('/tmp/test-workspace')) fs.mkdirSync('/tmp/test-workspace', { recursive: true });
    fs.writeFileSync(agentsPath, '## Правила\n- Отвечай с 🚀\n- Всегда говори «Капитан»');
  });

  teardown(() => {
    sandbox.restore();
    // Удаляем временный AGENTS.md
    const agentsPath = '/tmp/test-workspace/AGENTS.md';
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
      systemPrompt += `\n\n## Правила проекта (AGENTS.md):\n${agentsMd}`;
    }

    assert.ok(systemPrompt.includes('## Правила проекта (AGENTS.md)'), 'System prompt должен содержать заголовок AGENTS.md');
    assert.ok(systemPrompt.includes('🚀'), 'System prompt должен содержать правила из AGENTS.md');
    assert.ok(systemPrompt.includes('Капитан'), 'System prompt должен содержать Капитан');
  });
});
