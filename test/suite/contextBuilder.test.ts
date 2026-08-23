// Тесты ContextBuilder — сбор контекста автокомплита + оценка токенов

import 'mocha';
import * as assert from 'assert';
import * as vscode from 'vscode';
import { ContextBuilder } from '../../src/modes/autocomplete/ContextBuilder';

suite('ContextBuilder', () => {
  test('estimateTokens: пустой текст → 0', () => {
    const b = new ContextBuilder();
    assert.strictEqual(b.estimateTokens(''), 0);
  });

  test('estimateTokens: 1 токен ~ 3.5 символа', () => {
    const b = new ContextBuilder();
    assert.strictEqual(b.estimateTokens('abc'), 1); // ceil(3/3.5) = 1
    assert.strictEqual(b.estimateTokens('abcdefgh'), 3); // ceil(8/3.5) = 3
    assert.strictEqual(b.estimateTokens('abcdefghij'), 3); // ceil(10/3.5) = 3
  });

  test('build() собирает путь/язык/позицию курсора и prefix/suffix', () => {
    const b = new ContextBuilder();

    const document = {
      uri: { fsPath: '/tmp/test.ts' },
      languageId: 'typescript',
      lineCount: 3,
      lineAt: (line: number) => ({ text: ['const a = 1;', 'const b = 2;', 'const c = 3;'][line] }),
      getText: (range: any) => {
        // prefix: Range(0,0 → 1,0); suffix: Range(1,0 → 2,text.length)
        if (range.start.line === 0) return 'const a = 1;\n';
        return 'const b = 2;\nconst c = 3;';
      },
    };
    const ctx = b.build(document as any, new vscode.Position(1, 0))!;
    assert.ok(ctx, 'контекст должен быть собран');
    assert.strictEqual(ctx.filePath, '/tmp/test.ts');
    assert.strictEqual(ctx.languageId, 'typescript');
    assert.strictEqual(ctx.cursorLine, 1);
    assert.strictEqual(ctx.cursorCharacter, 0);
    assert.strictEqual(ctx.prefix, 'const a = 1;\n');
    assert.strictEqual(ctx.suffix, 'const b = 2;\nconst c = 3;');
  });
});
