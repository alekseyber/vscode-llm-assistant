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
import { ChatViewProvider } from '../../../src/modes/chat/ChatViewProvider';
import { ConversationManager } from '../../../src/modes/chat/ConversationManager';
import { ProviderManager } from '../../../src/providers/manager';
import { RunHistoryStore } from '../../../src/shared/RunHistoryStore';
import { SessionLog } from '../../../src/shared/SessionLog';
import { applySettings, SettingsSnapshot } from './helpers/settings';
import { startStub, ndjson, json } from './helpers/net';
import { createFakeWebviewView, messagesOfType } from './helpers/webview';
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
    provider.resolveWebviewView(view as any, {} as any, { isCancellationRequested: false } as any);
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
    const userMessage = chatCall.messages.find((m: any) => m.role === 'user');
    assert.ok(userMessage, 'в запросе есть сообщение пользователя');
    // Нативный формат Ollama: картинка в `images`, текст — в `content`
    assert.ok(Array.isArray(userMessage.images) && userMessage.images.length === 1, `картинка в запросе: ${JSON.stringify(userMessage).slice(0, 300)}`);
    assert.strictEqual(userMessage.images[0], IMAGE_BASE64, 'это та самая картинка, без искажений');
    assert.ok(String(userMessage.content).includes('что на картинке'), 'текст вопроса рядом с картинкой');

    // История: прогон записан, а не потерян
    await waitFor(() => history.getRuns().length > 0, 5000);
    assert.strictEqual(history.getRuns()[0].status, 'success', 'прогон с картинкой записан как успешный');
  });

  test('E2E-16b: без capability vision картинка не отправляется, и это сказано словами', async () => {
    await start(['completion']);

    view.send({ type: 'attachFile', isImage: true, fileName: 'pixel.png', mimeType: 'image/png', base64: IMAGE_BASE64 });
    view.send({ type: 'sendMessage', text: 'что на картинке?', mode: 'chat' });

    await waitFor(() => messagesOfType(view, 'done').length > 0, 20_000, 100, 'ответ модели');
    const text = messagesOfType(view, 'streamChunk').map((m) => m.text).join('');
    assert.ok(
      text.includes('не поддерживает изображения'),
      `пользователь предупреждён, что картинка не ушла: ${text.slice(0, 300)}`,
    );

    // Картинка не попала ни в один запрос: иначе модель ответила бы «по картинке», а её не было
    const withImages = stub!.bodies.filter(
      (b) => Array.isArray(b?.messages) && b.messages.some((m: any) => Array.isArray(m.images) && m.images.length > 0),
    );
    assert.deepStrictEqual(withImages, [], 'ни один запрос не содержит картинку');
  });
});
