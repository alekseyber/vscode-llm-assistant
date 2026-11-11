// Тесты AutocompleteController — настройки, выбор модели, потолок ответа, тумблер.
//
// Проверяется то, что видно пользователю: подсказка появляется только когда автокомплит
// включён, модель берётся из настроек и поддерживается провайдером, ответ обрезается и
// очищается от обрамления, ошибка не ломает ввод.

import 'mocha';
import * as assert from 'assert';
import * as vscode from 'vscode';
import { AutocompleteController } from '../../src/modes/autocomplete/AutocompleteController';

type ChatCall = { messages: any[]; options: any; signal?: AbortSignal };

/** Провайдер-двойник: отдаёт заранее заданный ответ потоком, как настоящий. */
function makeProvider(response: string | (() => string), options: { models?: string[]; isLocal?: boolean } = {}) {
  const calls: ChatCall[] = [];
  const provider = {
    name: 'stub',
    isLocal: options.isLocal ?? false,
    models: async () => options.models ?? ['gpt-4o'],
    chat: (messages: any[], opts: any, signal?: AbortSignal) => {
      calls.push({ messages, options: opts, signal });
      const text = typeof response === 'function' ? response() : response;
      // Отдаём кусками, как настоящий стрим
      return (async function* () {
        for (let i = 0; i < text.length; i += 7) {
          yield text.slice(i, i + 7);
        }
      })();
    },
  };
  return { provider, calls };
}

function makeController(provider: any) {
  const manager = { getDefault: () => provider, getAll: () => (provider ? [provider] : []) };
  const controller = new AutocompleteController(manager as any);
  return controller;
}

/** Провайдер inline-завершений, зарегистрированный последним. */
function lastInlineProvider(): vscode.InlineCompletionItemProvider {
  const providers = (vscode as any).__inlineProviders as vscode.InlineCompletionItemProvider[];
  assert.ok(providers.length > 0, 'провайдер inline-завершений не зарегистрирован');
  return providers[providers.length - 1];
}

function makeDocument(text = 'function main() {\n  \n}\n'): vscode.TextDocument {
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
    uri: { scheme: 'file', fsPath: '/fake/workspace/src/example.ts', toString: () => 'file:///fake/workspace/src/example.ts' },
    languageId: 'typescript',
    lineCount: lines.length,
    lineAt: (line: number) => ({ text: lines[line] ?? '' }),
    getText: (range?: any) =>
      range ? text.slice(toOffset(range.start.line, range.start.character), toOffset(range.end.line, range.end.character)) : text,
  } as unknown as vscode.TextDocument;
}

async function ask(provider: vscode.InlineCompletionItemProvider) {
  const source = new vscode.CancellationTokenSource();
  return provider.provideInlineCompletionItems!(
    makeDocument(),
    new vscode.Position(1, 2),
    {} as vscode.InlineCompletionContext,
    source.token as vscode.CancellationToken,
  ) as Promise<vscode.InlineCompletionList | null>;
}

suite('AutocompleteController', () => {
  setup(() => {
    const settings = (vscode.workspace as any).__settings as Record<string, unknown>;
    for (const key of Object.keys(settings)) delete settings[key];
  });

  test('ACL-1: выключенный в настройках автокомплит не зовёт модель', async () => {
    (vscode.workspace as any).__settings['llmAssistant.autocomplete.enabled'] = false;
    const { provider, calls } = makeProvider('const a = 1;');
    const controller = makeController(provider);
    const result = await ask(lastInlineProvider());
    assert.strictEqual(result, null, 'выключенный автокомплит молчит');
    assert.strictEqual(calls.length, 0, 'запрос к модели не уходит');
    controller.dispose();
  });

  test('ACL-2: правка настройки на лету подхватывается без перезапуска', async () => {
    const { provider, calls } = makeProvider('const a = 1;');
    const controller = makeController(provider);
    assert.ok(await ask(lastInlineProvider()), 'по умолчанию автокомплит включён');

    (vscode.workspace as any).__settings['llmAssistant.autocomplete.enabled'] = false;
    (vscode.workspace as any).__fireDidChangeConfiguration({
      affectsConfiguration: (section: string) => section.startsWith('llmAssistant.autocomplete'),
    });

    const before = calls.length;
    assert.strictEqual(await ask(lastInlineProvider()), null, 'после отключения подсказок нет');
    assert.strictEqual(calls.length, before, 'после отключения модель не вызывается');
    controller.dispose();
  });

  test('ACL-3: модель из настроек, ответ очищен от обрамления', async () => {
    (vscode.workspace as any).__settings['llmAssistant.defaultModel'] = 'gpt-4o';
    const { provider, calls } = makeProvider('```ts\nconst answer = 42;\n```');
    const controller = makeController(provider);
    const result = await ask(lastInlineProvider());

    assert.strictEqual(calls.length, 1);
    assert.strictEqual(calls[0].options.model, 'gpt-4o', 'модель берётся из настроек');
    assert.strictEqual(calls[0].options.maxTokens, 128, 'потолок ответа автокомплита — 128 токенов');
    assert.strictEqual(calls[0].options.stream, true, 'запрос идёт потоком');
    assert.ok(result, 'подсказка показана');
    const text = String(result!.items[0].insertText);
    assert.ok(!text.includes('```'), `обрамление снято: ${JSON.stringify(text)}`);
    assert.ok(text.includes('const answer = 42;'), `код сохранён: ${JSON.stringify(text)}`);
    controller.dispose();
  });

  test('ACL-4: неизвестная модель заменяется на первую доступную у провайдера', async () => {
    (vscode.workspace as any).__settings['llmAssistant.defaultModel'] = 'model-that-does-not-exist';
    const { provider, calls } = makeProvider('ok();', { models: ['local-model'] });
    const controller = makeController(provider);
    await ask(lastInlineProvider());
    assert.strictEqual(calls[0].options.model, 'local-model', 'взята модель, которую провайдер реально поддерживает');
    controller.dispose();
  });

  test('ACL-5: длинный ответ обрезается по потолку символов', async () => {
    const long = 'x'.repeat(4000);
    const { provider, calls } = makeProvider(long);
    const controller = makeController(provider);
    const result = await ask(lastInlineProvider());
    assert.strictEqual(calls.length, 1);
    assert.ok(result, 'подсказка показана');
    assert.ok(String(result!.items[0].insertText).length <= 1024, 'ответ автокомплита не длиннее 1024 символов');
    controller.dispose();
  });

  test('ACL-6: без провайдера по умолчанию автокомплит молчит и не падает', async () => {
    const controller = makeController(undefined);
    const result = await ask(lastInlineProvider());
    assert.strictEqual(result, null);
    controller.dispose();
  });

  test('ACL-7: ошибка провайдера не показывается как подсказка', async () => {
    const provider = {
      name: 'broken',
      models: async () => ['gpt-4o'],
      chat: () => {
        throw new Error('провайдер недоступен');
      },
    };
    const controller = makeController(provider);
    const result = await ask(lastInlineProvider());
    assert.strictEqual(result, null, 'ошибка превращается в отсутствие подсказки');
    controller.dispose();
  });

  test('ACL-8: тумблер переключает настройку и гасит подсказки', async () => {
    const { provider, calls } = makeProvider('const a = 1;');
    const controller = makeController(provider);
    assert.ok(await ask(lastInlineProvider()), 'до переключения подсказка есть');

    controller.toggleAutocomplete();
    const settings = (vscode.workspace as any).__settings as Record<string, unknown>;
    assert.strictEqual(settings['llmAssistant.autocomplete.enabled'], false, 'настройка записана');

    const before = calls.length;
    assert.strictEqual(await ask(lastInlineProvider()), null, 'после выключения подсказок нет');
    assert.strictEqual(calls.length, before, 'модель не вызывается');

    controller.toggleAutocomplete();
    assert.strictEqual(settings['llmAssistant.autocomplete.enabled'], true, 'второе нажатие включает обратно');
    controller.dispose();
  });

  test('ACL-9: dispose снимает регистрацию провайдера', () => {
    const { provider } = makeProvider('const a = 1;');
    const before = ((vscode as any).__inlineProviders as unknown[]).length;
    const controller = makeController(provider);
    assert.strictEqual(((vscode as any).__inlineProviders as unknown[]).length, before + 1, 'провайдер зарегистрирован');
    controller.dispose();
    assert.strictEqual(((vscode as any).__inlineProviders as unknown[]).length, before, 'после dispose регистрация снята');
  });
});
