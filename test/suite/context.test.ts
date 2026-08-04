// Тесты для ContextBuilder — сбор контекста автокомплита
// Проверяет: сбор префикса/суффикса из редактора, оценку токенов,
// ограничение по строкам и токенам

import 'mocha';
import * as sinon from 'sinon';
import * as vscode from 'vscode';
import * as assert from 'assert';
import { ContextBuilder, AutocompleteContext } from '../../src/modes/autocomplete/ContextBuilder';

suite('ContextBuilder', () => {
  let sandbox: sinon.SinonSandbox;
  let builder: ContextBuilder;

  setup(() => {
    sandbox = sinon.createSandbox();
    builder = new ContextBuilder();
  });

  teardown(() => {
    sandbox.restore();
  });

  /**
   * Создаёт mock-редактор с заданным содержимым, позицией курсора и языком.
   */
  function createMockEditor(
    content: string,
    line: number,
    character: number,
    languageId = 'typescript',
    filePath = '/test/file.ts'
  ): vscode.TextEditor {
    const lines = content.split('\n');

    // Создаём mock документа
    const mockDocument = {
      uri: { fsPath: filePath } as vscode.Uri,
      languageId,
      lineCount: lines.length,
      getText: sandbox.fake((range?: vscode.Range) => {
        if (!range) return content;
        if (range.start.line === range.end.line) {
          return lines[range.start.line]?.slice(range.start.character, range.end.character) ?? '';
        }
        const resultLines: string[] = [];
        for (let i = range.start.line; i <= range.end.line; i++) {
          if (i === range.start.line) {
            resultLines.push(lines[i].slice(range.start.character));
          } else if (i === range.end.line) {
            resultLines.push(lines[i].slice(0, range.end.character));
          } else {
            resultLines.push(lines[i]);
          }
        }
        return resultLines.join('\n');
      }),
      lineAt: sandbox.fake((lineNum: number) => ({
        lineNumber: lineNum,
        text: lines[lineNum] ?? '',
        range: new vscode.Range(lineNum, 0, lineNum, (lines[lineNum] ?? '').length),
        rangeIncludingLineBreak: new vscode.Range(lineNum, 0, lineNum, (lines[lineNum] ?? '').length),
        firstNonWhitespaceCharacterIndex: 0,
        isEmptyOrWhitespace: (lines[lineNum] ?? '').trim().length === 0,
      })),
    } as any as vscode.TextDocument;

    const mockPosition = new vscode.Position(line, character);

    const mockSelection = {
      active: mockPosition,
      anchor: mockPosition,
      start: mockPosition,
      end: mockPosition,
      isEmpty: true,
      isReversed: false,
    } as any as vscode.Selection;

    // Создаём mock редактора
    const mockEditor = {
      document: mockDocument,
      selection: mockSelection,
    } as any as vscode.TextEditor;

    return mockEditor;
  }

  test('build() возвращает контекст с префиксом и суффиксом', () => {
    const content = [
      'import { something } from "module";',
      '',
      'function test() {',
      '  const x = 1;',
      '  const y = 2;',
      '  return x + y;',
      '}',
      '',
    ].join('\n');

    // Курсор на строке 3 (0-indexed), символ 12
    const editor = createMockEditor(content, 3, 12);
    const context = builder.build(editor);

    assert.ok(context, 'Контекст должен быть создан');
    assert.strictEqual(context!.filePath, '/test/file.ts');
    assert.strictEqual(context!.languageId, 'typescript');
    assert.strictEqual(context!.cursorLine, 3);
    assert.strictEqual(context!.cursorCharacter, 12);
  });

  test('build() возвращает корректный префикс (текст до курсора)', () => {
    const content = 'line1\nline2\nline3\nline4\n';
    const editor = createMockEditor(content, 2, 3);

    // Курсор на 3-й строке (0-indexed: 2), 3-м символе
    // prefix = строки 0-2, текст до позиции 3
    // Ожидаем: "line1\nline2\nlin" (первые 3 символа строки 2)
    const context = builder.build(editor);

    const expectedPrefix = 'line1\nline2\nlin';
    assert.strictEqual(context!.prefix, expectedPrefix);
  });

  test('build() возвращает корректный суффикс (текст после курсора)', () => {
    const content = 'line1\nline2\nline3\nline4\n';
    const editor = createMockEditor(content, 1, 3);

    // Курсор на 2-й строке (0-indexed: 1), 3-м символе
    // suffix = строка 1 от позиции 3 + строка 2 + строка 3
    const context = builder.build(editor);

    const expectedSuffix = 'e2\nline3\nline4\n';
    assert.strictEqual(context!.suffix, expectedSuffix);
  });

  test('estimateTokens() оценивает количество токенов', () => {
    // 1 токен ~ 3.5 символа
    const text = 'hello world';
    // 11 символов / 3.5 ≈ 3.14 → ceil = 4
    const tokens = builder.estimateTokens(text);

    assert.strictEqual(tokens, Math.ceil(text.length / 3.5), 'Оценка должна соответствовать формуле');
  });

  test('estimateTokens() возвращает 0 для пустого текста', () => {
    assert.strictEqual(builder.estimateTokens(''), 0);
  });

  test('build() ограничивает префикс по токенам', () => {
    // Создаём длинный текст, который нужно обрезать
    const lines: string[] = [];
    for (let i = 0; i < 250; i++) {
      lines.push(`// Строка ${i}: const x${i} = ${i * 100};`);
    }
    const content = lines.join('\n');
    // Курсор в конце последней строки — префикс = весь файл до курсора
    const lastLineLength = lines[249].length;
    const editor = createMockEditor(content, 249, lastLineLength);

    const context = builder.build(editor);

    // Префикс должен быть обрезан (не может содержать все 250 строк)
    assert.ok(context!.prefix.length < content.length, 'Префикс должен быть короче всего текста');
    // При обрезании удаляются строки с НАЧАЛА — ближайшие к курсору сохраняются
    assert.ok(context!.prefix.includes('Строка 249'), 'Префикс должен содержать строку с курсором');
    assert.ok(!context!.prefix.includes('Строка 0'), 'Самые ранние строки должны быть отброшены');
  });

  test('build() обрабатывает начало файла (курсор на первой строке)', () => {
    const content = 'hello\nworld\n';
    const editor = createMockEditor(content, 0, 3);

    // prefix = "hel" (первые 3 символа строки 0)
    // suffix = "lo\nworld\n" (остаток строки 0 + строки 1+)
    const context = builder.build(editor);

    assert.strictEqual(context!.prefix, 'hel');
    assert.strictEqual(context!.suffix, 'lo\nworld\n');
  });

  test('build() обрабатывает конец файла (курсор на последней строке)', () => {
    const content = 'line1\nline2\nline3';
    const editor = createMockEditor(content, 2, 6);

    // prefix = "line1\nline2\nline3" (весь текст до курсора, 6 символов на строке 2)
    // suffix = "" (после курсора ничего нет)
    const context = builder.build(editor);

    assert.strictEqual(context!.prefix, 'line1\nline2\nline3');
    assert.strictEqual(context!.suffix, '');
  });

  test('truncateToTokens для prefix удаляет строки с начала', () => {
    // Прямой тест truncateToTokens (private, но можно проверить через build)
    // Создаём текст, который точно превысит лимит токенов
    const longContent = 'a\n'.repeat(5000);
    const editor = createMockEditor(longContent, 4999, 1);

    const context = builder.build(editor);

    // Префикс не должен быть пустым, но должен быть обрезан
    assert.ok(context!.prefix.length > 0, 'Префикс не должен быть пустым');
    assert.ok(context!.prefix.length < longContent.length, 'Префикс должен быть обрезан');
  });
});