// search_files: ранжирование, .gitignore и снятие потолка 500 файлов (P8a).
// Логика вынесена в чистые функции, чтобы проверяться без VS Code.

import 'mocha';
import * as assert from 'assert';
import * as sinon from 'sinon';
import * as vscode from 'vscode';
import { lineScore, parseGitignore, isIgnored, createTools } from '../../src/modes/apply/ToolDefinitions';

suite('search_files / ранжирование и ignore', () => {
  test('SF-1: объявления символов и совпадения в имени файла весят больше случайных вхождений', () => {
    const re = /totalPrice/;
    const decl = lineScore('function totalPrice(items) {', 'cart.js', /zzz/);
    const usage = lineScore('  console.log(totalPrice(order));', 'cart.js', /zzz/);
    const comment = lineScore('// totalPrice считает сумму', 'cart.js', /zzz/);
    const inName = lineScore('  console.log(totalPrice(order));', 'totalPrice.js', re);

    assert.ok(decl > usage, `объявление (${decl}) должно быть выше использования (${usage})`);
    assert.ok(usage > comment, `код (${usage}) должен быть выше комментария (${comment})`);
    assert.ok(inName > usage, `имя файла добавляет вес: ${inName} > ${usage}`);
  });

  test('SF-2: parseGitignore отбрасывает комментарии и отрицания', () => {
    const rules = parseGitignore('# comment\nnode_modules/\n!important.txt\n/dist\n*.log\n');
    assert.deepStrictEqual(rules, ['node_modules', 'dist', '*.log']);
  });

  test('SF-3: isIgnored ловит каталог и шаблон с *', () => {
    const rules = ['node_modules', 'dist', '*.log'];
    assert.strictEqual(isIgnored('node_modules/foo/index.js', rules), true);
    assert.strictEqual(isIgnored('packages/a/node_modules/x.js', rules), true);
    assert.strictEqual(isIgnored('debug.log', rules), true);
    assert.strictEqual(isIgnored('src/index.ts', rules), false);
  });
});

suite('search_files / интеграция', () => {
  let sb: any;
  setup(() => { sb = sinon.createSandbox(); });
  teardown(() => sb.restore());

  test('SF-4: файлы из .gitignore не попадают в выдачу, объявления идут первыми', async () => {
    const root = '/fake/workspace';
    const files = [
      vscode.Uri.file(`${root}/node_modules/pkg/idx.js`),
      vscode.Uri.file(`${root}/src/cart.js`),
    ];
    sb.stub(vscode.workspace, 'findFiles').resolves(files);
    sb.stub(vscode.workspace.fs, 'readFile').callsFake(async (uri: any) => {
      if (String(uri.fsPath).endsWith('.gitignore')) return new TextEncoder().encode('node_modules\n');
      if (String(uri.fsPath).includes('node_modules')) return new TextEncoder().encode('function totalPrice(){}\n');
      return new TextEncoder().encode('function totalPrice(items) {\n  return totalPrice;\n}\n');
    });
    sb.stub(vscode.workspace.fs, 'stat').resolves({ size: 100 });

    const tool = createTools().find((t) => t.name === 'search_files')!;
    const out = await tool.execute({ pattern: 'totalPrice' });

    assert.ok(!out.includes('node_modules'), `node_modules попал в выдачу: ${out}`);
    assert.ok(out.includes('пропущено по .gitignore'), 'нет пометки о пропуске по .gitignore');

    const declIdx = out.indexOf('function totalPrice(items)');
    const useIdx = out.indexOf('return totalPrice');
    assert.ok(declIdx !== -1 && useIdx !== -1, 'оба совпадения должны быть в выдаче');
    assert.ok(declIdx < useIdx, 'объявление должно идти раньше использования');
  });
});
