// Идемпотентность write_file: повторная запись того же содержимого не должна
// считаться изменением файла (модель дублирует write_file «на всякий случай»).

import 'mocha';
import * as assert from 'assert';
import * as sinon from 'sinon';
import * as vscode from 'vscode';
import { createTools } from '../../src/modes/apply/ToolDefinitions';

suite('write_file / идемпотентность', () => {
  let sandbox: any;
  let writeSpy: any;

  setup(() => {
    sandbox = sinon.createSandbox();
    writeSpy = sandbox.stub(vscode.workspace.fs, 'writeFile').resolves();
    sandbox.stub(vscode.workspace.fs, 'createDirectory').resolves();
  });
  teardown(() => sandbox.restore());

  const writeTool = () => createTools().find((t) => t.name === 'write_file')!;

  test('WF-1: содержимое совпадает → файл не перезаписывается', async () => {
    sandbox.stub(vscode.workspace.fs, 'readFile').resolves(new TextEncoder().encode('строка 3'));
    const result = await writeTool().execute({ path: 'apply-test.txt', content: 'строка 3' });
    assert.match(result, /не изменён/i);
    assert.strictEqual(writeSpy.called, false, 'writeFile не вызывался');
  });

  test('WF-2: содержимое отличается → файл записывается', async () => {
    sandbox.stub(vscode.workspace.fs, 'readFile').resolves(new TextEncoder().encode('строка 2'));
    const result = await writeTool().execute({ path: 'apply-test.txt', content: 'строка 3' });
    assert.match(result, /Файл записан/);
    assert.strictEqual(writeSpy.calledOnce, true);
  });

  test('WF-3: файла нет → создаётся', async () => {
    sandbox.stub(vscode.workspace.fs, 'readFile').rejects(new Error('FileNotFound'));
    const result = await writeTool().execute({ path: 'new.txt', content: 'x' });
    assert.match(result, /Файл записан/);
    assert.strictEqual(writeSpy.calledOnce, true);
  });
});
