// E2E-18: слэш-команды — собранный промпт доезжает до модели.
//
// Почему e2e: разбор `/имя` и таблица команд покрыты юнитами, но связка «сообщение панели →
// подстановка `promptTemplate` и аргумента → запрос к провайдеру» живёт в `handleSendMessage`
// и юнитами не проверяется. Поле ввода в WebView здесь не нужно: панель посылает
// `{type:'sendMessage', text:'/explain …'}` — ровно то, что делает настоящий webview.
//
// Границы: разбор, приоритет `.llma/skills` над встроенными командами и флаг `writes`
// остаются юнитам (`slashCommands.test.ts`, 14 тестов). Здесь — только сборка запроса.

import 'mocha';
import * as assert from 'assert';
import * as path from 'path';
import * as vscode from 'vscode';
import { ChatViewProvider } from '../../../src/modes/chat/ChatViewProvider';
import { ConversationManager } from '../../../src/modes/chat/ConversationManager';
import { ProviderManager } from '../../../src/providers/manager';
import { RunHistoryStore } from '../../../src/shared/RunHistoryStore';
import { SessionLog } from '../../../src/shared/SessionLog';
import { getSlashCommand } from '../../../src/modes/chat/SlashCommands';
import { applySettings, SettingsSnapshot } from './helpers/settings';
import { startStub, ndjson } from './helpers/net';
import { createFakeWebviewView, messagesOfType } from './helpers/webview';
import { fakeCancellationToken } from '../../support/vscode-harness';
import { waitFor } from './helpers/wait';

const REPO_ROOT = path.resolve(__dirname, '../../../..');

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

suite('E2E-18: слэш-команды', function () {
  this.timeout(60_000);

  let snap: SettingsSnapshot | undefined;
  let stub: Awaited<ReturnType<typeof startStub>> | undefined;
  let view: ReturnType<typeof createFakeWebviewView>;

  /** Текст всех сообщений, ушедших в модель последним запросом. */
  function lastPrompt(): string {
    const bodies = (stub?.bodies ?? []).filter((b) => Array.isArray(b?.messages));
    const body = bodies.at(-1);
    if (!body) return '';
    return body.messages
      .map((m: any) => (typeof m.content === 'string' ? m.content : JSON.stringify(m.content)))
      .join('\n');
  }

  setup(async () => {
    stub = await startStub((_req, res) =>
      ndjson(res, [
        { message: { role: 'assistant', content: 'ответ' }, done: false },
        { message: { role: 'assistant', content: '' }, done: true, prompt_eval_count: 50, eval_count: 3 },
      ]),
    );

    snap = await applySettings({
      providers: { local: { type: 'ollama', baseUrl: `http://${new URL(stub.url).host}`, title: 'Stub', models: ['qwen3:8b'] } },
      defaultProvider: 'local',
      defaultModel: 'qwen3:8b',
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
    const history = new RunHistoryStore(ctx.globalState);
    const provider = new ChatViewProvider(ctx, new ProviderManager(), conversation, history, undefined, undefined, sessionLog);

    view = createFakeWebviewView();
    provider.resolveWebviewView(view, { state: undefined }, fakeCancellationToken());
  });

  teardown(async () => {
    await snap?.restore();
    await stub?.close();
  });

  test('E2E-18a: /explain подставляет шаблон команды и аргумент в запрос к модели', async () => {
    const command = getSlashCommand('explain');
    assert.ok(command, 'команда /explain есть в таблице');

    view.send({ type: 'sendMessage', text: '/explain почему небо синее', mode: 'chat' });
    await waitFor(() => messagesOfType(view, 'done').length > 0, 20_000, 100, 'ответ модели');

    const prompt = lastPrompt();
    assert.ok(
      prompt.includes(command!.promptTemplate.slice(0, 60)),
      `в запросе шаблон команды, а не только текст пользователя: ${prompt.slice(0, 400)}`,
    );
    assert.ok(prompt.includes('почему небо синее'), `аргумент после команды сохранён: ${prompt.slice(0, 400)}`);
    assert.ok(
      !/(^|\n)\/explain(\s|$)/m.test(prompt),
      `сырая команда не уходит модели как команда: ${prompt.slice(0, 400)}`,
    );
  });

  test('E2E-18b: неизвестная команда уходит обычным текстом, без шаблона', async () => {
    const explain = getSlashCommand('explain');

    view.send({ type: 'sendMessage', text: '/nope сделай что-нибудь', mode: 'chat' });
    await waitFor(() => messagesOfType(view, 'done').length > 0, 20_000, 100, 'ответ модели');

    const prompt = lastPrompt();
    assert.ok(prompt.includes('/nope'), `неизвестная команда остаётся текстом: ${prompt.slice(0, 400)}`);
    assert.ok(
      !prompt.includes(explain!.promptTemplate.slice(0, 40)),
      `чужой шаблон не подставляется: ${prompt.slice(0, 400)}`,
    );
  });
});
