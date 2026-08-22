// E2E: активация расширения и регистрация команд в реальном VS Code Extension Host

import 'mocha';
import * as assert from 'assert';
import * as vscode from 'vscode';

const EXTENSION_ID = 'alekseyber.vscode-llm-assistant';

suite('E2E: активация и команды', () => {
  test('расширение найдено и активируется', async () => {
    const ext = vscode.extensions.getExtension(EXTENSION_ID);
    assert.ok(ext, `расширение ${EXTENSION_ID} найдено`);
    await ext!.activate();
    assert.strictEqual(ext!.isActive, true, 'расширение активно после activate()');
  });

  test('все 10 команд зарегистрированы', async () => {
    const ext = vscode.extensions.getExtension(EXTENSION_ID)!;
    await ext.activate();

    const commands = await vscode.commands.getCommands(true);
    const expected = [
      'llmAssistant.chat.focus',
      'llmAssistant.chat.addSelection',
      'llmAssistant.edit.selection',
      'llmAssistant.autocomplete.toggle',
      'llmAssistant.apply.start',
      'llmAssistant.selectProvider',
      'llmAssistant.openHistory',
      'llmAssistant.review.file',
      'llmAssistant.exportSession',
      'llmAssistant.forkSession',
    ];
    for (const cmd of expected) {
      assert.ok(commands.includes(cmd), `команда ${cmd} зарегистрирована`);
    }
  });

  test('forkSession выполняется без ошибок (smoke)', async () => {
    const ext = vscode.extensions.getExtension(EXTENSION_ID)!;
    await ext.activate();
    // fork не бросает — логика дублирования покрыта unit-тестом registerCommands
    await vscode.commands.executeCommand('llmAssistant.forkSession');
  });
});
