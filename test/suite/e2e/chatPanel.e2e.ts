// E2E-3: панель чата на живом NDJSON — от сообщения панели до записи в историю.
// AC: E2E-3

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
import { startStub, ndjson } from './helpers/net';
import { createFakeWebviewView, messagesOfType, streamedText } from './helpers/webview';
import { fakeCancellationToken, stubDialogs } from '../../support/vscode-harness';
import { waitFor } from './helpers/wait';

/** Мини-Memento: хранит значения в памяти, как globalState/workspaceState. */
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

const REPO_ROOT = path.resolve(__dirname, '../../../..');

suite('E2E-3: панель чата на живом NDJSON', () => {
  let snap: SettingsSnapshot | undefined;
  let view: ReturnType<typeof createFakeWebviewView>;
  let provider: ChatViewProvider;
  let history: RunHistoryStore;
  let sessionLog: SessionLog;
  let conversation: ConversationManager;

  const stubUrl = { value: '' };

  async function liveOllama(promptEvalCount = 20): Promise<{ url: string; close: () => Promise<void> }> {
    return startStub((_req, res) =>
      ndjson(res, [
        { message: { role: 'assistant', content: 'При' }, done: false },
        { message: { role: 'assistant', content: 'вет' }, done: false },
        { message: { role: 'assistant', content: '' }, done: true, prompt_eval_count: promptEvalCount, eval_count: 2 },
      ]),
    );
  }

  async function buildPanel(baseUrl: string): Promise<void> {
    snap = await applySettings({
      providers: { local: { type: 'ollama', baseUrl, title: 'Ollama (локально)', models: ['qwen3:8b'] } },
      defaultProvider: 'local',
      defaultModel: 'qwen3:8b',
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
    sessionLog = new SessionLog(ctx.workspaceState);
    conversation = new ConversationManager(ctx.workspaceState, sessionLog);
    history = new RunHistoryStore(ctx.globalState);
    const pm = new ProviderManager();
    provider = new ChatViewProvider(ctx, pm, conversation, history, undefined, undefined, sessionLog);

    view = createFakeWebviewView();
    provider.resolveWebviewView(view, { state: undefined }, fakeCancellationToken());
  }

  teardown(async () => {
    await snap?.restore();
    snap = undefined;
  });

  test('E2E-3a: сообщение панели → склейка стрима, done, tokens с cost 0, запись в историю и лог', async function () {
    this.timeout(30000);
    const stub = await liveOllama();
    stubUrl.value = stub.url;
    try {
      await buildPanel(stub.url);
      view.send({ type: 'sendMessage', text: 'привет', mode: 'chat', provider: 'local', model: 'qwen3:8b' });
      await waitFor(() => messagesOfType(view, 'done').length > 0, 20000, 50, 'done из панели');

      assert.strictEqual(streamedText(view), 'Привет', 'чанки склеились в ожидаемый текст');

      const tokens = messagesOfType(view, 'tokens')[0];
      assert.ok(tokens, 'панель получила токены');
      assert.strictEqual(tokens.cost, 0, 'стоимость локальной модели — 0');

      const run = history.getRuns(1)[0];
      assert.ok(run, 'прогон записан в историю');
      assert.strictEqual(run.provider, 'local');
      assert.strictEqual(run.cost, 0, 'в истории тоже 0, а не DEFAULT_PRICING');

      const sid = conversation.session.getActive()?.meta.id ?? 'default';
      const events = sessionLog.getEvents(sid);
      assert.ok(
        events.some((e) => e.type === 'assistant/chunk'),
        'ответ попал в session-log',
      );
    } finally {
      await stub.close();
    }
  });

  test('E2E-3b: предупреждение об обрезке приходит один раз на модель', async function () {
    this.timeout(30000);
    const stub = await liveOllama(4096);
    const warnings: string[] = [];
    const dialogs = stubDialogs({
      warning: (msg) => {
        warnings.push(String(msg));
        return undefined;
      },
    });
    try {
      await buildPanel(stub.url);
      view.send({ type: 'sendMessage', text: 'раз', mode: 'chat', provider: 'local', model: 'qwen3:8b' });
      await waitFor(() => messagesOfType(view, 'done').length > 0, 20000, 50, 'первый done');

      view.send({ type: 'sendMessage', text: 'два', mode: 'chat', provider: 'local', model: 'qwen3:8b' });
      await waitFor(() => messagesOfType(view, 'done').length > 1, 20000, 50, 'второй done');

      const truncation = warnings.filter((w) => /вероятно, обрезан/.test(w));
      assert.strictEqual(truncation.length, 1, `предупреждение ровно одно, получено: ${truncation.length}`);
    } finally {
      dialogs.restore();
      await stub.close();
    }
  });

  test('E2E-3c: cancelRequest останавливает поток', async function () {
    this.timeout(30000);
    // Медленный стрим: чанк раз в 300 мс, чтобы успеть отменить
    const stub = await startStub((_req, res) => {
      res.writeHead(200, { 'Content-Type': 'application/x-ndjson' });
      let i = 0;
      const timer = setInterval(() => {
        i += 1;
        res.write(JSON.stringify({ message: { role: 'assistant', content: `ч${i}` }, done: false }) + '\n');
        if (i >= 20) {
          clearInterval(timer);
          res.end();
        }
      }, 300);
      res.on('close', () => clearInterval(timer));
    });
    try {
      await buildPanel(stub.url);
      view.send({ type: 'sendMessage', text: 'долго', mode: 'chat', provider: 'local', model: 'qwen3:8b' });
      await waitFor(() => messagesOfType(view, 'streamChunk').length >= 2, 10000, 50, 'первые чанки');
      view.send({ type: 'cancelRequest' });

      await waitFor(() => messagesOfType(view, 'cancelled').length > 0, 5000, 50, 'cancelled');
      assert.ok(messagesOfType(view, 'done').length === 0, 'после отмены done не приходит');
    } finally {
      await stub.close();
    }
  });

  test('E2E-3d: HTML панели собран — без незаполненных плейсхолдеров', async function () {
    this.timeout(20000);
    const stub = await liveOllama();
    try {
      await buildPanel(stub.url);
      const html = view.webview.html;
      assert.ok(html.length > 10000, `html подозрительно короткий: ${html.length}`);
      assert.ok(!html.includes('{{'), 'в html не осталось плейсхолдеров {{…}}');
      assert.ok(html.includes('styles.css') || html.includes('message-input') || html.includes('<style'), 'стили/разметка на месте');
    } finally {
      await stub.close();
    }
  });
});
