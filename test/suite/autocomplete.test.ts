// Тесты GhostTextManager — провайдер inline-завершений (ghost text).
//
// Проверяется поведение, которое видит пользователь: когда подсказка показывается,
// когда молчит и что происходит при отмене. Раньше файл был самым заметным
// непокрытым местом расширения (143 строки, 0 тестов — аудит 11.11).

import 'mocha';
import * as assert from 'assert';
import * as vscode from 'vscode';
import { GhostTextManager } from '../../src/modes/autocomplete/GhostTextManager';
import { AutocompleteContext } from '../../src/modes/autocomplete/ContextBuilder';

/** Документ с настоящим `getText(range)`: провайдер собирает по нему контекст. */
function makeDocument(text: string, options: { scheme?: string } = {}): vscode.TextDocument {
  const lines = text.split('\n');
  const offsets: number[] = [];
  let offset = 0;
  for (const line of lines) {
    offsets.push(offset);
    offset += line.length + 1;
  }
  const toOffset = (line: number, character: number) =>
    (offsets[Math.min(line, lines.length - 1)] ?? 0) + character;

  return {
    uri: {
      scheme: options.scheme ?? 'file',
      fsPath: '/fake/workspace/src/example.ts',
      toString: () => `file:///fake/workspace/src/${Buffer.from(text).toString('hex').slice(0, 12)}.ts`,
    },
    languageId: 'typescript',
    lineCount: lines.length,
    lineAt: (line: number) => ({ text: lines[line] ?? '' }),
    getText: (range?: any) => {
      if (!range) return text;
      const start = toOffset(range.start.line, range.start.character);
      const end = toOffset(range.end.line, range.end.character);
      return text.slice(start, end);
    },
  } as unknown as vscode.TextDocument;
}

function makeManager(options: {
  response?: string | null | (() => Promise<string | null>);
  enabled?: boolean;
}) {
  const calls: Array<{ ctx: AutocompleteContext; signal?: AbortSignal }> = [];
  const manager = new GhostTextManager(async (ctx, signal) => {
    calls.push({ ctx, signal });
    const response = options.response;
    if (typeof response === 'function') return response();
    return response === undefined ? 'const value = 42;' : response;
  }, () => options.enabled ?? true);
  return { manager, calls };
}

async function ask(manager: GhostTextManager, doc: vscode.TextDocument, line = 1, character = 0) {
  const source = new vscode.CancellationTokenSource();
  const position = new vscode.Position(line, character);
  const result = await manager.provideInlineCompletionItems(
    doc,
    position,
    {} as vscode.InlineCompletionContext,
    source.token as vscode.CancellationToken,
  );
  return { result, source };
}

suite('GhostTextManager', () => {
  const document = makeDocument('function main() {\n  \n}\n');

  test('GHT-1: выключенный автокомплит не обращается к модели', async () => {
    const { manager, calls } = makeManager({ enabled: false });
    const { result } = await ask(manager, document);
    assert.strictEqual(result, null, 'выключенный автокомплит не должен показывать подсказку');
    assert.strictEqual(calls.length, 0, 'запрос к модели при выключенном автокомплите не уходит');
    manager.dispose();
  });

  test('GHT-2: чужая схема документа (output, diff) пропускается', async () => {
    const { manager, calls } = makeManager({});
    const { result } = await ask(manager, makeDocument('текст\n', { scheme: 'output' }));
    assert.strictEqual(result, null);
    assert.strictEqual(calls.length, 0, 'по документам output-схемы запрос не уходит');
    manager.dispose();
  });

  test('GHT-3: пустой ответ модели не показывается как подсказка', async () => {
    for (const response of ['', '   \n  ', null]) {
      const { manager } = makeManager({ response });
      const { result } = await ask(manager, document);
      assert.strictEqual(result, null, `ответ ${JSON.stringify(response)} не должен показываться`);
      manager.dispose();
    }
  });

  test('GHT-4: подсказка показывается и вставляется в позицию курсора', async () => {
    const { manager, calls } = makeManager({ response: '  return 42;' });
    const { result } = await ask(manager, document, 1, 2);
    assert.ok(result, 'подсказка должна быть показана');
    assert.strictEqual(result!.items.length, 1);
    assert.strictEqual(result!.items[0].insertText, '  return 42;');
    const range = result!.items[0].range as vscode.Range;
    assert.strictEqual(range.start.line, 1);
    assert.strictEqual(range.start.character, 2);
    assert.strictEqual(calls.length, 1, 'модель вызывается один раз');
    manager.dispose();
  });

  test('GHT-5: тот же ответ подряд не предлагается дважды', async () => {
    const { manager } = makeManager({ response: 'const a = 1;' });
    const first = await ask(manager, document);
    const second = await ask(manager, document);
    assert.ok(first.result, 'первая подсказка показывается');
    assert.strictEqual(second.result, null, 'повтор того же предложения не показывается');

    manager.clearSuggestion();
    const third = await ask(manager, document);
    assert.ok(third.result, 'после сброса кэша подсказка снова показывается');
    manager.dispose();
  });

  test('GHT-6: другой документ не считается повтором', async () => {
    const { manager } = makeManager({ response: 'const a = 1;' });
    const first = await ask(manager, makeDocument('a\n'));
    const second = await ask(manager, makeDocument('b\n'));
    assert.ok(first.result && second.result, 'для другого документа подсказка показывается снова');
    manager.dispose();
  });

  test('GHT-7: отмена запроса прерывает обращение к модели', async () => {
    const signals: AbortSignal[] = [];
    const manager = new GhostTextManager(
      async (_ctx, signal) => {
        signals.push(signal!);
        // Модель «думает», отмена приходит от VS Code
        await new Promise((resolve) => setTimeout(resolve, 5));
        return signal?.aborted ? null : 'late();';
      },
      () => true,
    );
    const doc = makeDocument('x\n');
    const source = new vscode.CancellationTokenSource();
    const promise = manager.provideInlineCompletionItems(
      doc,
      new vscode.Position(0, 1),
      {} as vscode.InlineCompletionContext,
      source.token as vscode.CancellationToken,
    );
    await new Promise((resolve) => setTimeout(resolve, 1)); // дать запросу начаться
    source.cancel();
    const result = await promise;
    assert.strictEqual(signals.length, 1, 'запрос к модели начался');
    assert.ok(signals[0].aborted, 'отмена VS Code должна доходить до запроса как AbortSignal');
    assert.strictEqual(result, null, 'отменённый запрос не показывает подсказку');
    manager.dispose();
  });

  test('GHT-8: ошибка модели не ломает автокомплит', async () => {
    const { manager } = makeManager({
      response: () => Promise.reject(new Error('сеть недоступна')),
    });
    const { result } = await ask(manager, document);
    assert.strictEqual(result, null, 'ошибка запроса превращается в отсутствие подсказки');

    // Следующий запрос после ошибки обязан снова работать
    const { manager: healthy } = makeManager({ response: 'ok();' });
    const next = await ask(healthy, document);
    assert.ok(next.result, 'после ошибки автокомплит продолжает работать');
    manager.dispose();
    healthy.dispose();
  });
});
