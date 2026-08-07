// Тесты для AgentsMdLoader — загрузка AGENTS.md из корня workspace
// Проверяет: загрузку существующего файла, возврат null для отсутствующего,
// кеширование и инвалидацию, настройку llmAssistant.agentsMd.enabled,
// интеграцию с AgentController и ChatViewProvider

import 'mocha';
import * as sinon from 'sinon';
import * as vscode from 'vscode';
import * as assert from 'assert';
import * as path from 'path';
import * as os from 'os';
import * as fs from 'fs/promises';
import { loadAgentsMd, invalidateCache } from '../../src/shared/AgentsMdLoader';
import { ConversationManager } from '../../src/modes/chat/ConversationManager';
import { ChatMessage } from '../../src/providers/types';

suite('AgentsMdLoader', () => {
  let sandbox: sinon.SinonSandbox;
  let tempDir: string;
  let tempAgentsMdPath: string;

  setup(async () => {
    sandbox = sinon.createSandbox();

    // Создаём временную папку для тестов
    tempDir = path.join(os.tmpdir(), `vscode-llm-test-${Date.now()}`);
    const llmaDir = path.join(tempDir, '.llma');
    await fs.mkdir(llmaDir, { recursive: true });
    tempAgentsMdPath = path.join(llmaDir, 'main.md');
  });

  teardown(async () => {
    sandbox.restore();
    // Сбрасываем кеш между тестами
    invalidateCache();
    // Удаляем временную папку
    try { await fs.rm(tempDir, { recursive: true, force: true }); } catch { /* ok */ }
  });

  /**
   * Настроить мок vscode.workspace с нужным workspaceRoot и настройкой agentsMd.enabled.
   */
  function mockWorkspace(workspacePath: string, agentsMdEnabled: boolean = true): void {
    // Мокаем workspaceFolders
    sandbox.stub(vscode.workspace, 'workspaceFolders').value([
      { uri: vscode.Uri.file(workspacePath), name: 'test', index: 0 },
    ]);

    // Мокаем getConfiguration
    const mockConfig = {
      get: sandbox.fake((key: string, defaultValue?: unknown) => {
        if (key === 'agentsMd.enabled') return agentsMdEnabled;
        if (key === 'chat.maxContextTokens') return 4096;
        return defaultValue;
      }),
      has: sandbox.fake(() => false),
      inspect: sandbox.fake(() => undefined),
      update: sandbox.fake(() => Promise.resolve()),
    };
    sandbox.stub(vscode.workspace, 'getConfiguration').returns(mockConfig as any);
  }

  // ── AC-1.1: loadAgentsMd() возвращает содержимое AGENTS.md ──
  test('AC-1.1: loadAgentsMd() возвращает содержимое AGENTS.md из корня workspace', async () => {
    const content = '# Правила проекта\nВсе ответы на русском.';
    await fs.writeFile(tempAgentsMdPath, content, 'utf-8');
    mockWorkspace(tempDir);

    const result = await loadAgentsMd();
    assert.strictEqual(result, content, 'Должно вернуть содержимое файла');
  });

  // ── AC-1.2: отсутствующий файл → null ──
  test('AC-1.2: Если AGENTS.md отсутствует — возвращает null', async () => {
    mockWorkspace(tempDir);
    // Файл не создаём

    const result = await loadAgentsMd();
    assert.strictEqual(result, null, 'Должен вернуть null для отсутствующего файла');
  });

  // ── AC-1.5: настройка llmAssistant.agentsMd.enabled: false ──
  test('AC-1.5: llmAssistant.agentsMd.enabled: false отключает загрузку', async () => {
    const content = '# Правила\nОтветы только по-русски.';
    await fs.writeFile(tempAgentsMdPath, content, 'utf-8');
    mockWorkspace(tempDir, false); // disabled

    const result = await loadAgentsMd();
    assert.strictEqual(result, null, 'При отключённой настройке должен вернуть null');
  });

  // ── Кеширование: повторный вызов возвращает закешированное значение ──
  test('AGENTS.md кешируется: повторный вызов не читает файл заново', async () => {
    const content = '# Правила v1';
    await fs.writeFile(tempAgentsMdPath, content, 'utf-8');
    mockWorkspace(tempDir);

    // Первый вызов — читает файл
    const result1 = await loadAgentsMd();
    assert.strictEqual(result1, content);

    // Изменяем файл на диске (симулируем внешнее изменение)
    await fs.writeFile(tempAgentsMdPath, '# Правила v2', 'utf-8');

    // Без инвалидации кеш должен вернуть старое значение
    const result2 = await loadAgentsMd();
    assert.strictEqual(result2, content, 'Без инвалидации должен вернуть закешированное значение');
  });

  // ── AC-1.6: инвалидация кеша при изменении файла ──
  test('AC-1.6: Кеш инвалидируется при ручном вызове invalidateCache()', async () => {
    const content = '# Правила v1';
    await fs.writeFile(tempAgentsMdPath, content, 'utf-8');
    mockWorkspace(tempDir);

    // Первый вызов
    const result1 = await loadAgentsMd();
    assert.strictEqual(result1, content);

    // Изменяем файл
    const newContent = '# Правила v2 — обновлённые';
    await fs.writeFile(tempAgentsMdPath, newContent, 'utf-8');

    // Инвалидируем кеш вручную
    invalidateCache();

    // Следующий вызов должен прочитать новый файл
    const result2 = await loadAgentsMd();
    assert.strictEqual(result2, newContent, 'После инвалидации должен вернуть новое содержимое');
  });

  // ── Нет workspace → null ──
  test('Если нет workspace — возвращает null', async () => {
    // Не мокаем workspaceFolders — оно undefined
    sandbox.stub(vscode.workspace, 'workspaceFolders').value(undefined);

    const mockConfig = {
      get: sandbox.fake((_key: string, defaultValue?: unknown) => defaultValue),
      has: sandbox.fake(() => false),
      inspect: sandbox.fake(() => undefined),
      update: sandbox.fake(() => Promise.resolve()),
    };
    sandbox.stub(vscode.workspace, 'getConfiguration').returns(mockConfig as any);

    const result = await loadAgentsMd();
    assert.strictEqual(result, null);
  });
});

/**
 * Интеграционные тесты: проверка, что AGENTS.md попадает в system prompt
 * ConversationManager и AgentController.
 */
suite('AgentsMd Integration — ConversationManager и system prompt', () => {
  let sandbox: sinon.SinonSandbox;
  let tempDir: string;
  let tempAgentsMdPath: string;

  setup(async () => {
    sandbox = sinon.createSandbox();
    tempDir = path.join(os.tmpdir(), `vscode-llm-test-int-${Date.now()}`);
    const llmaDir = path.join(tempDir, '.llma');
    await fs.mkdir(llmaDir, { recursive: true });
    tempAgentsMdPath = path.join(llmaDir, 'main.md');
    invalidateCache();
  });

  teardown(async () => {
    sandbox.restore();
    invalidateCache();
    try { await fs.rm(tempDir, { recursive: true, force: true }); } catch { /* ok */ }
  });

  function setupMocks(workspacePath: string, agentsMdEnabled: boolean = true): sinon.SinonStubbedInstance<vscode.Memento> {
    // Мокаем workspaceFolders
    sandbox.stub(vscode.workspace, 'workspaceFolders').value([
      { uri: vscode.Uri.file(workspacePath), name: 'test', index: 0 },
    ]);

    // Мокаем getConfiguration
    const mockConfig = {
      get: sandbox.fake((key: string, defaultValue?: unknown) => {
        if (key === 'agentsMd.enabled') return agentsMdEnabled;
        if (key === 'chat.maxContextTokens') return 4096;
        return defaultValue;
      }),
      has: sandbox.fake(() => false),
      inspect: sandbox.fake(() => undefined),
      update: sandbox.fake(() => Promise.resolve()),
    };
    sandbox.stub(vscode.workspace, 'getConfiguration').returns(mockConfig as any);

    // Мокаем Memento для ConversationManager
    const storage: sinon.SinonStubbedInstance<vscode.Memento> = {
      get: sandbox.stub().returns([]),
      update: sandbox.stub(),
      keys: sandbox.stub().returns([]),
      setKeysForSync: sandbox.stub(),
    } as any;

    return storage;
  }

  // ── AC-1.4: System prompt чата содержит правила из AGENTS.md ──
  test('AC-1.4: getMessagesForRequest() добавляет AGENTS.md в system message', async () => {
    const agentsMdContent = '# Правила чата\nОтвечай кратко и по-русски.\nНе используй markdown-таблицы.';
    await fs.writeFile(tempAgentsMdPath, agentsMdContent, 'utf-8');

    const storage = setupMocks(tempDir);
    const manager = new ConversationManager(storage);

    const messages = await manager.getMessagesForRequest();

    // Первое сообщение должно быть system с AGENTS.md
    assert.strictEqual(messages.length, 1, 'Только system message (нет истории)');
    assert.strictEqual(messages[0].role, 'system');

    const systemContent = messages[0].content as string;
    assert.ok(
      systemContent.includes('## Правила проекта (AGENTS.md):'),
      'System prompt должен содержать заголовок "## Правила проекта (AGENTS.md):"'
    );
    assert.ok(
      systemContent.includes(agentsMdContent),
      'System prompt должен содержать текст AGENTS.md'
    );
  });

  // ── AC-1.4: без AGENTS.md system prompt не меняется ──
  test('AC-1.4: Без AGENTS.md system prompt не содержит заголовок правил', async () => {
    // Файл AGENTS.md не создаём
    const storage = setupMocks(tempDir);
    const manager = new ConversationManager(storage);

    const messages = await manager.getMessagesForRequest();

    assert.strictEqual(messages.length, 1, 'Только system message');
    assert.strictEqual(messages[0].role, 'system');

    const systemContent = messages[0].content as string;
    assert.ok(
      !systemContent.includes('## Правила проекта (AGENTS.md):'),
      'System prompt НЕ должен содержать заголовок AGENTS.md если файла нет'
    );
  });

  // ── AC-1.5: отключённая настройка → нет AGENTS.md в system prompt ──
  test('AC-1.5 интеграция: llmAssistant.agentsMd.enabled: false исключает AGENTS.md из system prompt', async () => {
    const agentsMdContent = '# Правила';
    await fs.writeFile(tempAgentsMdPath, agentsMdContent, 'utf-8');

    const storage = setupMocks(tempDir, false); // disabled
    const manager = new ConversationManager(storage);

    const messages = await manager.getMessagesForRequest();

    const systemContent = messages[0].content as string;
    assert.ok(
      !systemContent.includes('## Правила проекта (AGENTS.md):'),
      'System prompt НЕ должен содержать AGENTS.md при отключённой настройке'
    );
  });
});
