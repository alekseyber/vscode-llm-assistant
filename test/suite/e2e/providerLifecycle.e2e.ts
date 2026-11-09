// E2E-7: жизненный цикл провайдеров после правки настроек.
// Реальное событие onDidChangeConfiguration → refresh() → список в панели, подписи, цены.
// AC: E2E-7

import 'mocha';
import * as assert from 'assert';
import * as path from 'path';
import * as vscode from 'vscode';
import { ChatViewProvider } from '../../../src/modes/chat/ChatViewProvider';
import { ConversationManager } from '../../../src/modes/chat/ConversationManager';
import { ProviderManager } from '../../../src/providers/manager';
import { RunHistoryStore } from '../../../src/shared/RunHistoryStore';
import { applySettings, SettingsSnapshot } from './helpers/settings';
import { createFakeWebviewView, messagesOfType } from './helpers/webview';
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

suite('E2E-7: провайдеры после правки настроек', () => {
  let snap: SettingsSnapshot | undefined;
  let view: ReturnType<typeof createFakeWebviewView>;
  let manager: ProviderManager;

  const cfg = () => vscode.workspace.getConfiguration('llmAssistant');
  const lastProviderList = () => {
    const lists = messagesOfType(view, 'providerList');
    return lists.length ? lists[lists.length - 1].providers : {};
  };

  async function buildPanel(): Promise<void> {
    const ctx: any = {
      subscriptions: [],
      extensionUri: vscode.Uri.file(REPO_ROOT),
      globalState: memoryMemento(),
      workspaceState: memoryMemento(),
    };
    const sessionLog = undefined;
    const conversation = new ConversationManager(ctx.workspaceState, sessionLog);
    const history = new RunHistoryStore(ctx.globalState);
    manager = new ProviderManager();
    const provider = new ChatViewProvider(ctx, manager, conversation, history);
    view = createFakeWebviewView();
    provider.resolveWebviewView(view as any, {} as any, { isCancellationRequested: false } as any);
    // Настоящая панель на загрузке шлёт 'ready' — только после этого хост отдаёт список провайдеров
    view.send({ type: 'ready' });
  }

  teardown(async () => {
    await snap?.restore();
    snap = undefined;
  });

  test('E2E-7: правка settings → refresh: новый провайдер с человеческой подписью, цена 0, удаление убирает из списка', async function () {
    this.timeout(40000);
    snap = await buildInitial();
    try {
      await waitFor(() => Object.keys(lastProviderList()).length > 0, 15000, 50, 'первый список провайдеров');
      assert.ok(lastProviderList().local, 'исходный провайдер в списке');

      // Добавляем локальный openai-провайдер так, как это делает пользователь в Settings
      await cfg().update(
        'providers',
        {
          local: { type: 'ollama', baseUrl: 'http://127.0.0.1:11434', title: 'Ollama (локально)', models: ['qwen3:8b'] },
          'local-llamacpp': {
            type: 'openai',
            baseUrl: 'http://127.0.0.1:8080/v1',
            title: 'llama.cpp (локально)',
            models: ['qwen3-8b'],
          },
        },
        vscode.ConfigurationTarget.Global,
      );

      // Ждём именно перерисовку списка после refresh(), а не таймаут
      await waitFor(() => !!lastProviderList()['local-llamacpp'], 15000, 50, 'новый провайдер в списке');

      const list = lastProviderList();
      assert.strictEqual(list.local.title, 'Ollama (локально)');
      assert.strictEqual(list['local-llamacpp'].title, 'llama.cpp (локально)');
      assert.strictEqual(list['local-llamacpp'].isLocal, true, 'локальность по адресу, а не по типу');
      assert.deepStrictEqual(
        manager.pricingMap.get('qwen3-8b'),
        { input: 0, output: 0 },
        'цена локальной модели осталась нулевой после refresh()',
      );

      // Убираем запись — провайдер должен исчезнуть из списка
      await cfg().update(
        'providers',
        { local: { type: 'ollama', baseUrl: 'http://127.0.0.1:11434', title: 'Ollama (локально)', models: ['qwen3:8b'] } },
        vscode.ConfigurationTarget.Global,
      );
      await waitFor(() => !lastProviderList()['local-llamacpp'], 15000, 50, 'провайдер удалён из списка');
      assert.ok(manager.getProvider('local-llamacpp') === undefined, 'и из менеджера тоже');
    } finally {
      // пусто — restore в teardown
    }
  });

  async function buildInitial(): Promise<SettingsSnapshot> {
    const snapshot = await applySettings({
      providers: { local: { type: 'ollama', baseUrl: 'http://127.0.0.1:11434', title: 'Ollama (локально)', models: ['qwen3:8b'] } },
      defaultProvider: 'local',
      defaultModel: 'qwen3:8b',
    });
    await buildPanel();
    return snapshot;
  }
});
