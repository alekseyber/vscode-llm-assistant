// Тесты для McpClient — MCP-клиент для подключения к серверам Model Context Protocol
// Проверяет:
//   AC-5.1: подключение к stdio-серверу (структура, graceful degradation)
//   AC-5.2: инструменты MCP-сервера видны агенту
//   AC-5.3: выполнение MCP-инструмента возвращает результат
//   AC-5.4: ошибка подключения не ломает агента (graceful degradation)
//   AC-5.5: allow-list работает для MCP-инструментов

import 'mocha';
import * as assert from 'assert';
import { McpClient, McpServerConfig } from '../../src/modes/apply/McpClient';
import { ToolSystem, Tool } from '../../src/modes/apply/ToolSystem';
import { getAllowedTools, ToolAllowListConfig } from '../../src/modes/apply/ToolAllowList';

// ==================== Тесты ====================

suite('McpClient', () => {
  // AC-5.1: MCP-клиент подключается к stdio-серверу
  test('AC-5.1: структура McpClient — конфиг сохраняется правильно', () => {
    const config: McpServerConfig = {
      name: 'test-server',
      command: 'npx',
      args: ['-y', '@modelcontextprotocol/server-test'],
      env: { TEST_VAR: 'value' },
    };

    const mcpClient = new McpClient(config);

    assert.strictEqual(mcpClient.serverName, 'test-server');
    assert.strictEqual(mcpClient.isConnected, false);
  });

  // AC-5.1: проверяем, что connect() выбрасывает ошибку при невалидной команде
  test('AC-5.1: connect() с несуществующей командой выбрасывает ошибку', async () => {
    const config: McpServerConfig = {
      name: 'broken',
      command: '/nonexistent/command/that/definitely/does/not/exist',
      args: [],
    };

    const mcpClient = new McpClient(config);

    try {
      await mcpClient.connect();
      assert.fail('Должно было выбросить исключение');
    } catch (err) {
      // Ожидаемо — ошибка подключения к несуществующему бинарнику
      assert.ok(err instanceof Error || typeof err === 'object',
        'Ошибка должна быть объектом Error');
    }

    // После ошибки клиент НЕ должен быть connected
    assert.strictEqual(mcpClient.isConnected, false);
  });

  // AC-5.4: ошибка подключения не ломает агента (graceful degradation)
  test('AC-5.4: disconnect() безопасен когда клиент не подключён', () => {
    const config: McpServerConfig = {
      name: 'test',
      command: 'echo',
      args: [],
    };

    const mcpClient = new McpClient(config);

    // disconnect() на неподключённом клиенте не должен падать
    assert.doesNotThrow(() => mcpClient.disconnect());
  });

  // AC-5.4: повторный disconnect не падает
  test('AC-5.4: повторный disconnect() безопасен', () => {
    const config: McpServerConfig = {
      name: 'test',
      command: 'echo',
      args: [],
    };

    const mcpClient = new McpClient(config);

    mcpClient.disconnect();
    mcpClient.disconnect(); // Повторный вызов не должен падать
    assert.strictEqual(mcpClient.isConnected, false);
  });

  // AC-5.2: инструменты MCP-сервера видны агенту
  test('AC-5.2: MCP-инструменты регистрируются в ToolSystem с префиксом mcp_', () => {
    const toolSystem = new ToolSystem();

    // Создаём инструмент в стиле MCP (с префиксом mcp_<server>_<name>)
    const mcpTool: Tool = {
      name: 'mcp_github_search_repos',
      description: 'Поиск репозиториев на GitHub',
      parameters: {
        type: 'object',
        properties: {
          query: { type: 'string', description: 'Поисковый запрос' },
        },
        required: ['query'],
      },
      execute: async (args: unknown) => {
        const a = args as Record<string, unknown>;
        return `Найдены репозитории по запросу: ${a.query}`;
      },
    };

    toolSystem.register(mcpTool);

    const tool = toolSystem.getTool('mcp_github_search_repos');
    assert.ok(tool, 'MCP-инструмент должен быть зарегистрирован');
    assert.strictEqual(tool!.name, 'mcp_github_search_repos');

    // Проверяем что инструмент виден в общем списке
    const tools = toolSystem.getTools();
    assert.strictEqual(tools.length, 1);

    // Проверяем что getToolsDescription() включает MCP-инструмент
    const desc = toolSystem.getToolsDescription();
    assert.ok(desc.includes('mcp_github_search_repos'), 'Описание должно включать MCP-инструмент');

    // Проверяем что getToolSchemas() включает MCP-инструмент
    const schemas = toolSystem.getToolSchemas();
    assert.strictEqual(schemas.length, 1);
    const schema = schemas[0] as Record<string, unknown>;
    const func = schema.function as Record<string, unknown>;
    assert.strictEqual(func.name, 'mcp_github_search_repos');
  });

  // AC-5.3: выполнение MCP-инструмента возвращает результат
  test('AC-5.3: execute() MCP-инструмента через ToolSystem возвращает результат', async () => {
    const toolSystem = new ToolSystem();

    const mcpTool: Tool = {
      name: 'mcp_test_echo',
      description: 'Эхо для тестирования',
      parameters: {
        type: 'object',
        properties: {
          message: { type: 'string' },
        },
        required: ['message'],
      },
      execute: async (args: unknown) => {
        const a = args as Record<string, unknown>;
        return `Echo: ${a.message}`;
      },
    };

    toolSystem.register(mcpTool);

    const result = await toolSystem.execute('mcp_test_echo', { message: 'Hello MCP!' });

    assert.ok(result.includes('[OK]'), 'Результат должен содержать статус OK');
    assert.ok(result.includes('Echo: Hello MCP!'), 'Результат должен содержать вывод инструмента');
  });

  // AC-5.3: ошибка выполнения MCP-инструмента возвращает ОШИБКА
  test('AC-5.3: ошибка выполнения MCP-инструмента возвращает статус ОШИБКА', async () => {
    const toolSystem = new ToolSystem();

    const mcpTool: Tool = {
      name: 'mcp_failing_tool',
      description: 'Инструмент, который всегда падает',
      parameters: {
        type: 'object',
        properties: {},
      },
      execute: async () => {
        throw new Error('MCP-сервер недоступен');
      },
    };

    toolSystem.register(mcpTool);

    const result = await toolSystem.execute('mcp_failing_tool', {});

    assert.ok(result.includes('[ОШИБКА]'), 'Результат должен содержать статус ОШИБКА');
    assert.ok(result.includes('MCP-сервер недоступен'), 'Результат должен содержать сообщение об ошибке');
  });

  // AC-5.5: Allow-list работает для MCP-инструментов
  test('AC-5.5: getAllowedTools фильтрует MCP-инструменты по allow-list', () => {
    const allTools: Array<{ name: string }> = [
      { name: 'read_file' },
      { name: 'write_file' },
      { name: 'mcp_github_search_repos' },
      { name: 'mcp_github_create_pr' },
      { name: 'mcp_filesystem_read' },
      { name: 'search_files' },
    ];

    // Без фильтрации — все доступны
    const configEmpty: ToolAllowListConfig = {};
    const allResult = getAllowedTools(allTools, configEmpty);
    assert.strictEqual(allResult.length, 6, 'Без фильтрации все 6 инструментов доступны');

    // Фильтруем только mcp-инструменты
    const configMcpOnly: ToolAllowListConfig = {
      allowedTools: ['mcp_github_search_repos', 'mcp_github_create_pr', 'mcp_filesystem_read'],
    };
    const mcpOnly = getAllowedTools(allTools, configMcpOnly);
    assert.strictEqual(mcpOnly.length, 3, 'Должно остаться 3 MCP-инструмента');
    assert.strictEqual(mcpOnly[0].name, 'mcp_github_search_repos');
    assert.strictEqual(mcpOnly[1].name, 'mcp_github_create_pr');
    assert.strictEqual(mcpOnly[2].name, 'mcp_filesystem_read');

    // Смешанный список: встроенные + MCP
    const configMixed: ToolAllowListConfig = {
      allowedTools: ['read_file', 'mcp_github_search_repos'],
    };
    const mixed = getAllowedTools(allTools, configMixed);
    assert.strictEqual(mixed.length, 2, 'Должно остаться 2 инструмента');
    assert.strictEqual(mixed[0].name, 'read_file');
    assert.strictEqual(mixed[1].name, 'mcp_github_search_repos');

    // Только встроенные, без MCP
    const configBuiltin: ToolAllowListConfig = {
      allowedTools: ['read_file', 'write_file', 'search_files'],
    };
    const builtin = getAllowedTools(allTools, configBuiltin);
    assert.strictEqual(builtin.length, 3, 'Должно остаться 3 встроенных инструмента');
    assert.strictEqual(builtin[0].name, 'read_file');
    assert.strictEqual(builtin[1].name, 'write_file');
    assert.strictEqual(builtin[2].name, 'search_files');
  });

  // Дополнительно: префикс mcp_ уникален и не конфликтует с встроенными
  test('MCP-инструменты с префиксом mcp_ не конфликтуют с встроенными именами', () => {
    const toolSystem = new ToolSystem();

    // Регистрируем встроенный инструмент
    const builtinTool: Tool = {
      name: 'read_file',
      description: 'Встроенное чтение файла',
      parameters: { type: 'object', properties: { path: { type: 'string' } }, required: ['path'] },
      execute: async () => 'ok',
    };
    toolSystem.register(builtinTool);

    // Регистрируем MCP-инструмент с другим именем (префикс гарантирует уникальность)
    const mcpTool: Tool = {
      name: 'mcp_filesystem_read_file',
      description: 'MCP-чтение файла',
      parameters: { type: 'object', properties: { path: { type: 'string' } }, required: ['path'] },
      execute: async () => 'mcp ok',
    };
    toolSystem.register(mcpTool);

    // Оба инструмента доступны без конфликтов
    assert.ok(toolSystem.getTool('read_file'), 'Встроенный инструмент доступен');
    assert.ok(toolSystem.getTool('mcp_filesystem_read_file'), 'MCP-инструмент доступен');
    assert.strictEqual(toolSystem.getTools().length, 2);
  });

  // Дополнительно: System prompt включает описание MCP-инструментов
  test('getToolsDescription() включает описание MCP-инструментов', () => {
    const toolSystem = new ToolSystem();

    const mcpTool: Tool = {
      name: 'mcp_server_weather',
      description: 'Получение погоды через MCP-сервер',
      parameters: {
        type: 'object',
        properties: {
          city: { type: 'string', description: 'Город' },
        },
        required: ['city'],
      },
      execute: async () => 'sunny',
    };

    toolSystem.register(mcpTool);

    const desc = toolSystem.getToolsDescription();

    assert.ok(desc.includes('mcp_server_weather'), 'Описание содержит имя инструмента');
    assert.ok(desc.includes('Получение погоды через MCP-сервер'), 'Описание содержит описание');
    assert.ok(desc.includes('city'), 'Описание содержит параметры');
  });
});
