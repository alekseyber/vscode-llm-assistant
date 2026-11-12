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
import { fakeDocument } from '../support/fakes';

/** Документ с настоящим `getText(range)`: провайдер собирает по нему контекст. */
const makeDocument = (text: string, options: { scheme?: string; uri?: string } = {}) =>
  fakeDocument(text, options);

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

  test('GHT-6: другой документ не считается повтором даже при том же ответе', async () => {
    const { manager } = makeManager({ response: 'const a = 1;' });
    // URI заданы явно: кэш привязан к документу, а не к тексту
    const first = await ask(manager, makeDocument('a\n', { uri: 'file:///w/one.ts' }));
    const second = await ask(manager, makeDocument('a\n', { uri: 'file:///w/two.ts' }));
    assert.ok(first.result, 'первый документ получает подсказку');
    assert.ok(second.result, 'второй документ получает ту же подсказку — это не повтор');
    manager.dispose();
  });

  test('GHT-7: отмена прерывает незавершённый запрос', async () => {
    let release!: (value: string | null) => void;
    const signals: AbortSignal[] = [];
    const manager = new GhostTextManager(
      async (_ctx, signal) => {
        signals.push(signal!);
        // Запрос висит, пока тест не отпустит его вручную — никаких таймеров и гонок
        return new Promise<string | null>((resolve) => {
          release = resolve;
        }).then((value) => (signal?.aborted ? null : value));
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
    // Ждём, пока запрос действительно начнётся: без таймеров, по факту вызова модели
    while (signals.length === 0) await Promise.resolve();
    source.cancel();
    assert.ok(signals[0].aborted, 'отмена VS Code доходит до запроса как AbortSignal');
    release('late();');
    assert.strictEqual(await promise, null, 'отменённый запрос не показывает подсказку');
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

  test('GHT-9: отмена после получения ответа не отменяет показ', async () => {
    // Контракт: отмена проверяется до запроса и внутри него; готовый ответ показывается,
    // а скрывает его уже VS Code при следующем вводе (см. спеку, «Детали реализации»)
    const { manager } = makeManager({ response: 'ready();' });
    const doc = makeDocument('y\n', { uri: 'file:///w/ready.ts' });
    const source = new vscode.CancellationTokenSource();
    const promise = manager.provideInlineCompletionItems(
      doc,
      new vscode.Position(0, 1),
      {} as vscode.InlineCompletionContext,
      source.token as vscode.CancellationToken,
    );
    const result = await promise;
    source.cancel(); // отмена приходит уже после ответа
    assert.ok(result, 'готовый ответ не отбрасывается отменой, пришедшей после него');
    manager.dispose();
  });

  test('GHT-10: ответ из переводов строк не показывается', async () => {
    const { manager } = makeManager({ response: '\n\n   \n\t\n' });
    const { result } = await ask(manager, makeDocument('z\n', { uri: 'file:///w/blank.ts' }));
    assert.strictEqual(result, null, 'пустой по смыслу ответ не показывается');
    manager.dispose();
  });

  test('GHT-11: при пустом префиксе и непустом суффиксе запрос всё равно уходит', async () => {
    const { manager, calls } = makeManager({ response: 'tail();' });
    const position = new vscode.Position(0, 0);
    const doc = makeDocument('\nconst x = 1;\n', { uri: 'file:///w/empty-prefix.ts' });
    const source = new vscode.CancellationTokenSource();
    const result = await manager.provideInlineCompletionItems(
      doc,
      position,
      {} as vscode.InlineCompletionContext,
      source.token as vscode.CancellationToken,
    );
    assert.strictEqual(calls.length, 1, 'контекст с одним суффиксом достаточен для запроса');
    assert.ok(result, 'подсказка показана');
    manager.dispose();
  });

  test('GHT-12: два параллельных запроса не мешают друг другу', async () => {
    let n = 0;
    const manager = new GhostTextManager(
      async () => {
        n += 1;
        const value = `const v${n} = ${n};`;
        await new Promise((resolve) => setTimeout(resolve, n === 1 ? 5 : 0));
        return value;
      },
      () => true,
    );
    const [a, b] = await Promise.all([
      ask(manager, makeDocument('q\n', { uri: 'file:///w/par-a.ts' })),
      ask(manager, makeDocument('q\n', { uri: 'file:///w/par-b.ts' })),
    ]);
    assert.ok(a.result && b.result, 'оба параллельных запроса показывают свою подсказку');
    assert.notStrictEqual(
      String(a.result!.items[0].insertText),
      String(b.result!.items[0].insertText),
      'подсказки не перепутались между документами',
    );
    manager.dispose();
  });

  test('GHT-13: отмена одного параллельного запроса не отменяет второй', async () => {
    const resolvers: Array<(value: string | null) => void> = [];
    const signals: AbortSignal[] = [];
    const manager = new GhostTextManager(
      async (_ctx, signal) => {
        signals.push(signal!);
        return new Promise<string | null>((resolve) => resolvers.push(resolve)).then((value) =>
          signal?.aborted ? null : value,
        );
      },
      () => true,
    );
    const docA = makeDocument('a\n', { uri: 'file:///w/cancel-a.ts' });
    const docB = makeDocument('b\n', { uri: 'file:///w/cancel-b.ts' });
    const tokenA = new vscode.CancellationTokenSource();
    const tokenB = new vscode.CancellationTokenSource();
    const promiseA = manager.provideInlineCompletionItems(
      docA,
      new vscode.Position(0, 1),
      {} as vscode.InlineCompletionContext,
      tokenA.token as vscode.CancellationToken,
    );
    const promiseB = manager.provideInlineCompletionItems(
      docB,
      new vscode.Position(0, 1),
      {} as vscode.InlineCompletionContext,
      tokenB.token as vscode.CancellationToken,
    );
    while (resolvers.length < 2) await Promise.resolve();

    tokenA.cancel(); // отменяем только первый
    assert.ok(signals[0].aborted, 'отменённый запрос получил сигнал');
    assert.ok(!signals[1].aborted, 'второй запрос не затронут отменой первого');

    resolvers[1]('b-result();');
    resolvers[0]('a-result();');
    const [a, b] = await Promise.all([promiseA, promiseB]);
    assert.strictEqual(a, null, 'отменённый запрос ничего не показал');
    assert.ok(b, 'второй запрос показал свой ответ');
    assert.strictEqual(String(b!.items[0].insertText), 'b-result();', 'ответы не перепутаны');
    manager.dispose();
  });
});
