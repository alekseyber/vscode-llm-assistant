// Замер вызовов инструментов (0.14.75): сколько раз агент звал инструменты за прогон.
// Нужен, чтобы решение о локальном индексе принималось по цифрам, а не по гипотезе.
// AC: TCS-1, TCS-2

import 'mocha';
import * as sinon from 'sinon';
import * as vscode from 'vscode';
import * as assert from 'assert';
import { getTool, takeToolCallStats } from '../../src/modes/chat/ChatAgentTools';

suite('Счётчик вызовов инструментов', () => {
  let sandbox: sinon.SinonSandbox;

  setup(() => {
    sandbox = sinon.createSandbox();
    sandbox.stub(vscode.workspace, 'findFiles').resolves([]);
    sandbox.stub(vscode.workspace, 'workspaceFolders').value([{ uri: vscode.Uri.file('/ws'), name: 'ws', index: 0 }]);
    takeToolCallStats(); // чистое состояние между тестами
  });

  teardown(() => sandbox.restore());

  test('TCS-1: вызовы считаются по имени, снятие обнуляет', async () => {
    const search = getTool('search_files')!;
    const list = getTool('list_files')!;

    await search.execute({ pattern: 'cost' });
    await search.execute({ pattern: 'run' });
    await list.execute({ path: '.' }).catch(() => 'нет workspace — не важно');

    const stats = takeToolCallStats();
    assert.strictEqual(stats.search_files, 2, 'два вызова search_files');
    assert.deepStrictEqual(takeToolCallStats(), {}, 'после снятия счётчики пусты');
  });

  test('TCS-2: ошибка инструмента тоже считается (агент потратил шаг)', async () => {
    const search = getTool('search_files')!;
    await search.execute({ pattern: '(' }); // невалидный regex — инструмент вернёт текст ошибки

    assert.strictEqual(takeToolCallStats().search_files, 1);
  });
});
