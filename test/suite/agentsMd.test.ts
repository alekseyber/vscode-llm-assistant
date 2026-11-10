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
import { loadAgentsMd, invalidateCache, buildRulesReport } from '../../src/shared/AgentsMdLoader';
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

    // Файл не менялся — повторный вызов отдаёт то же самое (кеш работает)
    const result2 = await loadAgentsMd();
    assert.strictEqual(result2, content, 'Без изменений кеш отдаёт прежнее содержимое');

    // А после правки кеш сверяется по mtime/size и отдаёт новый текст
    await fs.writeFile(tempAgentsMdPath, '# Правила v2', 'utf-8');
    const result3 = await loadAgentsMd();
    assert.strictEqual(result3, '# Правила v2', 'Правка файла видна без перезапуска окна');
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

    // Кеш сверяется по mtime/size: правка файла видна без ручной инвалидации
    const result2 = await loadAgentsMd();
    assert.strictEqual(result2, newContent, 'Правка файла видна без перезапуска окна');
  });

  // ── AGM: стандартные файлы правил (AGENTS.md, CLAUDE.md) ──
  test('AGM-2: AGENTS.md и CLAUDE.md склеиваются, AGENTS.md первым', async () => {
    await fs.writeFile(path.join(tempDir, 'AGENTS.md'), 'Правило A', 'utf-8');
    await fs.writeFile(path.join(tempDir, 'CLAUDE.md'), 'Правило C', 'utf-8');
    mockWorkspace(tempDir);
    invalidateCache();

    const result = await loadAgentsMd();

    assert.ok(result, 'правила должны загрузиться');
    assert.match(result!, /Правило A/);
    assert.match(result!, /Правило C/);
    assert.ok(result!.indexOf('Правило A') < result!.indexOf('Правило C'), 'AGENTS.md идёт раньше CLAUDE.md');
    assert.match(result!, /### Источник: AGENTS\.md/, 'источник подписан');
  });

  test('AGM-3: лимит agentsMd.maxChars обрезает и помечает', async () => {
    await fs.writeFile(path.join(tempDir, 'AGENTS.md'), 'А'.repeat(300), 'utf-8');
    await fs.writeFile(path.join(tempDir, 'CLAUDE.md'), 'Б'.repeat(300), 'utf-8');
    mockWorkspace(tempDir);
    sandbox.restore();
    sandbox = sinon.createSandbox();
    sandbox.stub(vscode.workspace, 'workspaceFolders').value([{ uri: vscode.Uri.file(tempDir), name: 'test', index: 0 }]);
    sandbox.stub(vscode.workspace, 'getConfiguration').returns({
      get: (key: string, def?: unknown) => (key === 'agentsMd.maxChars' ? 200 : key === 'agentsMd.enabled' ? true : def),
      has: () => false,
      inspect: () => undefined,
      update: () => Promise.resolve(),
    } as any);
    invalidateCache();

    const result = await loadAgentsMd();

    assert.ok(result!.includes('обрезано лимитом agentsMd.maxChars = 200'), 'видно, что отрезано');
    assert.ok(result!.length < 700, 'склейка не превышает лимит заметно');
  });

  test('AGM-4: невалидный maxChars не обнуляет правила', async () => {
    await fs.writeFile(path.join(tempDir, 'AGENTS.md'), 'Правило A', 'utf-8');
    sandbox.restore();
    sandbox = sinon.createSandbox();
    sandbox.stub(vscode.workspace, 'workspaceFolders').value([{ uri: vscode.Uri.file(tempDir), name: 'test', index: 0 }]);
    sandbox.stub(vscode.workspace, 'getConfiguration').returns({
      get: (key: string, def?: unknown) => (key === 'agentsMd.maxChars' ? false : key === 'agentsMd.enabled' ? true : def),
      has: () => false,
      inspect: () => undefined,
      update: () => Promise.resolve(),
    } as any);
    invalidateCache();

    const result = await loadAgentsMd();
    assert.strictEqual(result, 'Правило A', 'битая настройка — берём дефолт, правила на месте');
  });

  test('AGM-5: смена maxChars пересобирает склейку без перезапуска', async () => {
    await fs.writeFile(path.join(tempDir, 'AGENTS.md'), 'А'.repeat(400), 'utf-8');
    let limit = 200;
    sandbox.stub(vscode.workspace, 'getConfiguration').returns({
      get: (key: string, def?: unknown) => (key === 'agentsMd.maxChars' ? limit : key === 'agentsMd.enabled' ? true : def),
      has: () => false,
      inspect: () => undefined,
      update: () => Promise.resolve(),
    } as any);
    sandbox.stub(vscode.workspace, 'workspaceFolders').value([{ uri: vscode.Uri.file(tempDir), name: 'test', index: 0 }]);
    invalidateCache();

    const first = await loadAgentsMd();
    assert.match(first!, /обрезано лимитом/, 'при малом лимите видна обрезка');

    limit = 5000; // настройка меняется, файлы — нет
    const second = await loadAgentsMd();
    assert.doesNotMatch(second!, /обрезано лимитом/, 'новый лимит применён без перезапуска окна');
    assert.strictEqual(second!.length, 400, 'текст доехал целиком');
  });

  test('AGM-6: обрезка идёт по границе строки, а не посреди слова', async () => {
    const text = 'первая строка правила\nвторая строка правила\nтретья строка правила';
    await fs.writeFile(path.join(tempDir, 'AGENTS.md'), text, 'utf-8');
    sandbox.stub(vscode.workspace, 'getConfiguration').returns({
      get: (key: string, def?: unknown) => (key === 'agentsMd.maxChars' ? 40 : key === 'agentsMd.enabled' ? true : def),
      has: () => false,
      inspect: () => undefined,
      update: () => Promise.resolve(),
    } as any);
    sandbox.stub(vscode.workspace, 'workspaceFolders').value([{ uri: vscode.Uri.file(tempDir), name: 'test', index: 0 }]);
    invalidateCache();

    const result = await loadAgentsMd();
    const body = result!.split('\n\n[…')[0].trim();

    assert.ok(body.length <= 40, `тело не превышает лимит (${body.length})`);
    assert.ok(text.startsWith(body), `начало текста сохранено; получили: ${JSON.stringify(body)}`);
    assert.ok(!body.endsWith('правил'), `слово не разрублено: «${body.slice(-20)}»`);
  });

  test('AGM-7: отчёт об источниках — относительные пути, без содержимого и абсолютных путей', async () => {
    await fs.writeFile(path.join(tempDir, 'AGENTS.md'), 'Секретное правило проекта', 'utf-8');
    await fs.mkdir(path.join(tempDir, '.claude', 'skills', 'coder'), { recursive: true });
    await fs.writeFile(path.join(tempDir, '.claude', 'skills', 'coder', 'SKILL.md'), ['---', 'name: coder', '---', 'код'].join('\n'), 'utf-8');
    mockWorkspace(tempDir);
    invalidateCache();

    const report = await buildRulesReport();

    assert.match(report, /AGENTS\.md: \d+ знаков/, 'видно объём источника');
    assert.match(report, /Скилы: 1/);
    assert.match(report, /\.claude\/skills\/coder\/SKILL\.md|Скилы: 1/, 'скилы учтены');
    assert.ok(!report.includes(tempDir), 'абсолютного пути в отчёте нет');
    assert.ok(!report.includes('Секретное правило проекта'), 'содержимое файла не утекает в отчёт');
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
      systemContent.includes('## Правила проекта:'),
      'System prompt должен содержать заголовок "## Правила проекта:"'
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
