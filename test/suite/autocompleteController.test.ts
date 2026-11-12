// Тесты AutocompleteController — настройки, выбор модели, потолок ответа, тумблер.
//
// Проверяется то, что видно пользователю: подсказка появляется только когда автокомплит
// включён, модель берётся из настроек и поддерживается провайдером, ответ обрезается и
// очищается от обрамления, ошибка не ломает ввод.

import 'mocha';
import * as assert from 'assert';
import * as vscode from 'vscode';
import { lastInlineProvider, mockInternals, resetSettings, setSetting } from '../support/vscode-harness';
import { AutocompleteController } from '../../src/modes/autocomplete/AutocompleteController';
import { ProviderManager } from '../../src/providers/manager';
import { LLMProvider } from '../../src/providers/types';
import { fakeDocument, fakeProvider } from '../support/fakes';

function makeProvider(response: string | (() => string), options: { models?: string[]; isLocal?: boolean } = {}) {
  const provider = fakeProvider({
    models: options.models ?? ['gpt-4o'],
    isLocal: options.isLocal,
    response: () => (typeof response === 'function' ? response() : response),
  });
  return { provider, calls: provider.calls };
}

/** Менеджер провайдеров с подменённым выбором по умолчанию: остальное ему не нужно. */
function makeController(provider: LLMProvider | undefined): AutocompleteController {
  const manager = new ProviderManager();
  manager.getDefault = () => provider;
  return new AutocompleteController(manager);
}

const makeDocument = (text = 'function main() {\n  \n}\n') => fakeDocument(text);

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
    resetSettings();
  });

  test('ACL-1: выключенный в настройках автокомплит не зовёт модель', async () => {
    setSetting('autocomplete.enabled', false);
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

    setSetting('autocomplete.enabled', false);
    mockInternals().fireConfigChange('llmAssistant.autocomplete');

    const before = calls.length;
    assert.strictEqual(await ask(lastInlineProvider()), null, 'после отключения подсказок нет');
    assert.strictEqual(calls.length, before, 'после отключения модель не вызывается');
    controller.dispose();
  });

  test('ACL-3: модель из настроек, ответ очищен от обрамления', async () => {
    setSetting('defaultModel', 'gpt-4o');
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
    setSetting('defaultModel', 'model-that-does-not-exist');
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

    await controller.toggleAutocomplete();
    assert.strictEqual(mockInternals().settings['llmAssistant.autocomplete.enabled'], false, 'настройка записана');

    const before = calls.length;
    assert.strictEqual(await ask(lastInlineProvider()), null, 'после выключения подсказок нет');
    assert.strictEqual(calls.length, before, 'модель не вызывается');

    await controller.toggleAutocomplete();
    assert.strictEqual(mockInternals().settings['llmAssistant.autocomplete.enabled'], true, 'второе нажатие включает обратно');
    controller.dispose();
  });

  test('ACL-9: dispose снимает регистрацию провайдера', () => {
    const { provider } = makeProvider('const a = 1;');
    const before = mockInternals().inlineProviders.length;
    const controller = makeController(provider);
    assert.strictEqual(mockInternals().inlineProviders.length, before + 1, 'провайдер зарегистрирован');
    controller.dispose();
    assert.strictEqual(mockInternals().inlineProviders.length, before, 'после dispose регистрация снята');
  });

  test('ACL-10: обрезка не разрывает суррогатную пару', async () => {
    // Ответ из эмодзи: 600 пар = 1200 UTF-16 единиц, потолок 1024 приходится на середину пары
    const { provider } = makeProvider('😀'.repeat(600));
    const controller = makeController(provider);
    const result = await ask(lastInlineProvider());
    assert.ok(result, 'подсказка показана');
    const text = String(result!.items[0].insertText);
    assert.strictEqual(Array.from(text).length, 600, 'все 600 эмодзи сохранены: 600 < потолка, терять нечего');
    // Разрезанная пара выглядит как одиночный суррогат: проверяем, что таких нет
    assert.ok(
      !/[\uD800-\uDBFF](?![\uDC00-\uDFFF])/.test(text),
      'в тексте не должно быть одиночных старших суррогатов',
    );
    controller.dispose();
  });

  test('ACL-11: на потолке режется ровно 1024 кодовых точки, пары целы', async () => {
    const { provider } = makeProvider('😀'.repeat(1200)); // 2400 UTF-16 единиц, 1200 точек
    const controller = makeController(provider);
    const result = await ask(lastInlineProvider());
    const text = String(result!.items[0].insertText);
    assert.strictEqual(Array.from(text).length, 1024, 'потолок — 1024 кодовых точки, не 512 пар');
    assert.ok(!/[\uD800-\uDBFF](?![\uDC00-\uDFFF])/.test(text), 'одиночных суррогатов нет');
    controller.dispose();
  });

  test('ACL-12: после ошибки провайдера следующий запрос снова спрашивает модель', async () => {
    let attempt = 0;
    const calls: any[] = [];
    const provider = {
      name: 'flaky',
      models: async () => ['gpt-4o'],
      chat: (messages: any[], options: any) => {
        calls.push(options);
        attempt += 1;
        if (attempt === 1) throw new Error('сеть недоступна');
        return (async function* () {
          yield 'recovered();';
        })();
      },
    };
    const controller = makeController(provider);
    assert.strictEqual(await ask(lastInlineProvider()), null, 'первый запрос падает — подсказки нет');
    const second = await ask(lastInlineProvider());
    assert.strictEqual(calls.length, 2, 'второй запрос дошёл до модели');
    assert.ok(second, 'после ошибки подсказка снова показывается');
    assert.strictEqual(String(second!.items[0].insertText), 'recovered();');
    controller.dispose();
  });
});
