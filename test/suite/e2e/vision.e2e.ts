// E2E-16: Vision — картинка доезжает до модели, а без capability честно предупреждаем.
//
// Почему e2e: дефект был не в конвертации, а в связке «вложение в панели → запрос к модели»:
// картинка молча выбрасывалась, модель отвечала «я не умею смотреть изображения», и это
// выглядело как ответ по картинке. Проверяется реальный HTTP-запрос к стабу в нативном
// формате Ollama (`/api/chat` с полем `images`), а не промежуточные функции.

import 'mocha';
import * as assert from 'assert';
import * as path from 'path';
import * as vscode from 'vscode';
import { ChatViewProvider, visionUnsupportedWarning } from '../../../src/modes/chat/ChatViewProvider';
import { ConversationManager } from '../../../src/modes/chat/ConversationManager';
import { ProviderManager } from '../../../src/providers/manager';
import { RunHistoryStore } from '../../../src/shared/RunHistoryStore';
import { SessionLog } from '../../../src/shared/SessionLog';
import { applySettings, SettingsSnapshot } from './helpers/settings';
import { startStub, ndjson, json } from './helpers/net';
import { createFakeWebviewView, messagesOfType } from './helpers/webview';
import { fakeCancellationToken } from '../../support/vscode-harness';
import { waitFor } from './helpers/wait';

const REPO_ROOT = path.resolve(__dirname, '../../../..');
const IMAGE_BASE64 = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==';

function memoryMemento(): any {
  const store = new Map<string, unknown>();
  return {
    get: (key: string, fallback?: unknown) => (store.has(key) ? store.get(key) : fallback),
    update: async (key: string, value: unknown) => {
      store.set(key, value);
    },
    keys: () => [...store.keys()],
  };
}

suite('E2E-16: Vision', function () {
  this.timeout(60_000);

  let snap: SettingsSnapshot | undefined;
  let stub: Awaited<ReturnType<typeof startStub>> | undefined;
  let view: ReturnType<typeof createFakeWebviewView>;
  let history: RunHistoryStore;

  /** Стаб: `/api/show` отдаёт заданные capabilities, `/api/chat` — поток из двух чанков. */
  async function start(capabilities: string[]): Promise<void> {
    stub = await startStub((req, res, body) => {
      if (req.url?.includes('/api/show')) {
        json(res, { capabilities, model_info: { 'general.context_length': 4096 } });
        return;
      }
      ndjson(res, [
        { message: { role: 'assistant', content: 'На картинке ' }, done: false },
        { message: { role: 'assistant', content: 'красный пиксель.' }, done: false },
        { message: { role: 'assistant', content: '' }, done: true, prompt_eval_count: 120, eval_count: 8 },
      ]);
      void body;
    });

    const started = stub!;
    snap = await applySettings({
      providers: { local: { type: 'ollama', baseUrl: `http://${new URL(started.url).host}`, title: 'Stub', models: ['gemma3:4b'] } },
      defaultProvider: 'local',
      defaultModel: 'gemma3:4b',
      'local.numCtx': 4096,
      'chat.summaryEnabled': false,
      'chat.includeOpenFile': false,
      'retry.enabled': false,
    });

    const ctx: any = {
      subscriptions: [],
      extensionUri: vscode.Uri.file(REPO_ROOT),
      globalState: memoryMemento(),
      workspaceState: memoryMemento(),
    };
    const sessionLog = new SessionLog(ctx.workspaceState);
    const conversation = new ConversationManager(ctx.workspaceState, sessionLog);
    history = new RunHistoryStore(ctx.globalState);
    const provider = new ChatViewProvider(ctx, new ProviderManager(), conversation, history, undefined, undefined, sessionLog);

    view = createFakeWebviewView();
    provider.resolveWebviewView(view, { state: undefined }, fakeCancellationToken());
  }

  teardown(async () => {
    await snap?.restore();
    await stub?.close();
  });

  test('E2E-16a: картинка уходит в запрос вместе с текстом, ответ доходит до чата', async () => {
    await start(['completion', 'vision']);

    // Как это делает панель: сначала вложение, затем сообщение
    view.send({ type: 'attachFile', isImage: true, fileName: 'pixel.png', mimeType: 'image/png', base64: IMAGE_BASE64 });
    view.send({ type: 'sendMessage', text: 'что на картинке?', mode: 'chat' });

    await waitFor(() => messagesOfType(view, 'done').length > 0, 20_000, 100, 'ответ модели');
    const text = messagesOfType(view, 'streamChunk').map((m) => m.text).join('');
    assert.ok(text.includes('красный пиксель'), `ответ модели в чате: ${text.slice(0, 300)}`);

    const chatCall = stub!.bodies.find((b) => Array.isArray(b?.messages));
    assert.ok(chatCall, 'запрос к модели был');
    const userMessages = chatCall.messages.filter((m: any) => m.role === 'user');
    assert.strictEqual(userMessages.length, 1, `одно сообщение пользователя: ${JSON.stringify(userMessages).slice(0, 200)}`);
    const userMessage = userMessages[0];
    // Нативный формат Ollama: картинка в `images`, текст — в `content`
    assert.ok(Array.isArray(userMessage.images) && userMessage.images.length === 1, `картинка в запросе: ${JSON.stringify(userMessage).slice(0, 300)}`);
    assert.strictEqual(userMessage.images[0], IMAGE_BASE64, 'это та самая картинка, без искажений');
    assert.ok(String(userMessage.content).includes('что на картинке'), 'текст вопроса рядом с картинкой');
    // Картинка не должна утечь в системное сообщение или в историю чата
    const withImages = chatCall.messages.filter((m: any) => Array.isArray(m.images) && m.images.length > 0);
    assert.strictEqual(withImages.length, 1, 'картинка ровно в одном сообщении — пользовательском');
    assert.strictEqual(withImages[0].role, 'user', `картинка не в системном сообщении: ${withImages[0].role}`);

    // История: прогон записан, а не потерян; base64 в текст задачи не просочился
    await waitFor(() => history.getRuns().length > 0, 5000);
    const run = history.getRuns()[0];
    assert.strictEqual(run.status, 'success', 'прогон с картинкой записан как успешный');
    assert.ok(!run.task.includes(IMAGE_BASE64.slice(0, 40)), `в задаче нет base64-мусора: ${run.task.slice(0, 120)}`);
  });

  test('E2E-16c: картинка без текста тоже доходит до модели', async () => {
    await start(['completion', 'vision']);

    view.send({ type: 'attachFile', isImage: true, fileName: 'pixel.png', mimeType: 'image/png', base64: IMAGE_BASE64 });
    view.send({ type: 'sendMessage', text: '', mode: 'chat' });

    await waitFor(() => messagesOfType(view, 'done').length > 0, 20_000, 100, 'ответ модели');
    const chatCall = stub!.bodies.find((b) => Array.isArray(b?.messages));
    const userMessage = chatCall?.messages.find((m: any) => m.role === 'user');
    assert.ok(
      Array.isArray(userMessage?.images) && userMessage.images.length === 1,
      `картинка ушла без текста: ${JSON.stringify(userMessage ?? {}).slice(0, 250)}`,
    );
  });

  test('E2E-16b: без capability vision картинка не отправляется, и это сказано словами', async () => {
    await start(['completion']);

    view.send({ type: 'attachFile', isImage: true, fileName: 'pixel.png', mimeType: 'image/png', base64: IMAGE_BASE64 });
    view.send({ type: 'sendMessage', text: 'что на картинке?', mode: 'chat' });

    await waitFor(() => messagesOfType(view, 'done').length > 0, 20_000, 100, 'ответ модели');
    // Запрос к модели обязан уйти: иначе «картинки нет» пройдёт и на молчащем клиенте
    assert.ok(
      stub!.bodies.some((b) => Array.isArray(b?.messages)),
      'запрос к модели был отправлен',
    );
    const text = messagesOfType(view, 'streamChunk').map((m) => m.text).join('');
    assert.ok(
      text.includes(visionUnsupportedWarning('gemma3:4b').slice(0, 40)),
      `пользователь предупреждён, что картинка не ушла: ${text.slice(0, 300)}`,
    );

    // Картинка не попала ни в один запрос: иначе модель ответила бы «по картинке», а её не было
    const withImages = stub!.bodies.filter(
      (b) => Array.isArray(b?.messages) && b.messages.some((m: any) => Array.isArray(m.images) && m.images.length > 0),
    );
    assert.deepStrictEqual(withImages, [], 'ни один запрос не содержит картинку');
  });
});
