// E2E-4: гейт подтверждения и отказ в агентском режиме.
// Реальная панель → ChatViewProvider → AgentWorker → стаб /api/chat с нативными tool_calls.
// AC: E2E-4

import 'mocha';
import * as assert from 'assert';
import * as fs from 'fs';
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
import { waitFor } from './helpers/wait';

const REPO_ROOT = path.resolve(__dirname, '../../../..');

function wsRoot(): string {
  const folder = vscode.workspace.workspaceFolders?.[0];
  assert.ok(folder, 'Extension Host должен быть запущен на копии фикстуры');
  return folder.uri.fsPath;
}

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

const TOOL_CALL = (targetFile: string) => ({
  message: {
    role: 'assistant',
    content: '',
    tool_calls: [{ function: { name: 'write_file', arguments: { path: targetFile, content: 'привет из e2e' } } }],
  },
  done: true,
  prompt_eval_count: 40,
  eval_count: 5,
});

const FINAL_TEXT = { message: { role: 'assistant', content: 'Готово.' }, done: true, prompt_eval_count: 45, eval_count: 3 };

/** Стаб /api/chat: первые `toolCalls` ответов — вызов write_file, дальше — обычный текст. */
async function toolStub(toolCalls: number, targetFile: string, bodies?: any[]) {
  let calls = 0;
  return startStub((_req, res, body) => {
    bodies?.push(body);
    calls += 1;
    return ndjson(res, [calls <= toolCalls ? TOOL_CALL(targetFile) : FINAL_TEXT]);
  });
}

suite('E2E-4: гейт подтверждения и отказ', () => {
  let snap: SettingsSnapshot | undefined;
  let view: ReturnType<typeof createFakeWebviewView>;
  let history: RunHistoryStore;
  const target = 'e2e-out.txt';
  const targetPath = () => path.join(wsRoot(), target);

  async function buildPanel(baseUrl: string, toolLoop: boolean): Promise<void> {
    snap = await applySettings({
      providers: { local: { type: 'ollama', baseUrl, title: 'Ollama (локально)', models: ['qwen3:8b'] } },
      defaultProvider: 'local',
      defaultModel: 'qwen3:8b',
      'local.toolLoop': toolLoop,
      'local.numCtx': 8192,
      'chat.summaryEnabled': false,
      'chat.includeOpenFile': false,
      'retry.enabled': false,
      'agent.maxIterations': 6,
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
    view.send({ type: 'ready' });
  }

  /** Отвечать на confirmAction заданным решением, пока прогон не закончится. */
  function autoRespond(approved: boolean): { stop: () => void } {
    const answered = new Set<string>();
    const timer = setInterval(() => {
      for (const message of messagesOfType(view, 'confirmAction')) {
        const id = String(message.requestId ?? message.id ?? '');
        if (answered.has(id)) continue;
        answered.add(id);
        view.send({ type: 'confirmResponse', requestId: message.requestId, id: message.id, approved });
      }
    }, 30);
    return { stop: () => clearInterval(timer) };
  }

  teardown(async () => {
    try {
      fs.rmSync(targetPath(), { force: true });
    } catch {
      /* нет файла — и хорошо */
    }
    await snap?.restore();
    snap = undefined;
  });

  test('E2E-4a: отказ → файл не создан; второй отказ подряд останавливает прогон', async function () {
    this.timeout(40000);
    const stub = await toolStub(3, target);
    try {
      await buildPanel(stub.url, true);
      const responder = autoRespond(false);
      view.send({ type: 'sendMessage', text: 'создай файл', mode: 'agent', provider: 'local', model: 'qwen3:8b' });
      await waitFor(() => messagesOfType(view, 'done').length > 0, 30000, 50, 'прогон завершился');
      responder.stop();

      assert.ok(!fs.existsSync(targetPath()), 'файл не создан после отказа');
      const text = streamedText(view);
      assert.match(text, /Правки не внесены/, 'прогон остановлен текстом «Правки не внесены»');
      assert.ok(
        messagesOfType(view, 'confirmAction').length >= 2,
        'подтверждение спрашивали повторно, а не молча повторили запись',
      );
    } finally {
      await stub.close();
    }
  });

  test('E2E-4b: подтверждение → файл записан с ожидаемым содержимым и сводкой «Изменено файлов: 1»', async function () {
    this.timeout(40000);
    const stub = await toolStub(1, target);
    try {
      await buildPanel(stub.url, true);
      const responder = autoRespond(true);
      view.send({ type: 'sendMessage', text: 'создай файл', mode: 'agent', provider: 'local', model: 'qwen3:8b' });
      await waitFor(() => messagesOfType(view, 'done').length > 0, 30000, 50, 'прогон завершился');
      responder.stop();

      assert.ok(fs.existsSync(targetPath()), 'файл создан после подтверждения');
      assert.strictEqual(fs.readFileSync(targetPath(), 'utf-8'), 'привет из e2e');
      assert.match(streamedText(view), /Изменено файлов: 1/, 'сводка считает файл по факту, а не по словам модели');
    } finally {
      await stub.close();
    }
  });

  test('E2E-4c: local.toolLoop=false → инструменты не вызываются, ответ объясняет как включить', async function () {
    this.timeout(30000);
    const bodies: any[] = [];
    const stub = await toolStub(1, target, bodies);
    try {
      await buildPanel(stub.url, false);
      view.send({ type: 'sendMessage', text: 'создай файл', mode: 'agent', provider: 'local', model: 'qwen3:8b' });
      await waitFor(() => messagesOfType(view, 'done').length > 0, 20000, 50, 'прогон завершился');

      assert.strictEqual(messagesOfType(view, 'confirmAction').length, 0, 'подтверждение не спрашивали — инструменты не запускались');
      assert.strictEqual(bodies.length, 0, 'к модели не ушло ни одного запроса');
      assert.ok(!fs.existsSync(targetPath()), 'файл не создан');
      assert.match(streamedText(view), /toolLoop/, 'ответ называет настройку, которой включается цикл');
    } finally {
      await stub.close();
    }
  });
});
