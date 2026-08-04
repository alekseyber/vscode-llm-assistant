// Тесты для ToolSystem — реестр инструментов агента
// Проверяет: регистрацию инструментов, выполнение, валидацию аргументов,
// форматирование результатов, описание инструментов

import 'mocha';
import * as assert from 'assert';
import { ToolSystem, Tool, ToolResult } from '../../src/modes/apply/ToolSystem';

suite('ToolSystem', () => {
  let toolSystem: ToolSystem;

  setup(() => {
    toolSystem = new ToolSystem();
  });

  // Создаём тестовый инструмент для проверки
  function createTestTool(overrides: Partial<Tool> = {}): Tool {
    return {
      name: 'test_tool',
      description: 'Тестовый инструмент',
      parameters: {
        type: 'object',
        properties: {
          name: { type: 'string', description: 'Имя' },
          count: { type: 'number', description: 'Количество' },
          enabled: { type: 'boolean', description: 'Включено' },
        },
        required: ['name'],
      },
      execute: async (args: any) => {
        return `Hello, ${args.name}! Count: ${args.count ?? 0}`;
      },
      ...overrides,
    };
  }

  test('AC-9.5: register() добавляет инструмент', () => {
    const tool = createTestTool();
    toolSystem.register(tool);

    const registered = toolSystem.getTool('test_tool');
    assert.ok(registered, 'Инструмент должен быть зарегистрирован');
    assert.strictEqual(registered!.name, 'test_tool');
  });

  test('register() выбрасывает ошибку при дублировании имени', () => {
    const tool = createTestTool();
    toolSystem.register(tool);

    assert.throws(
      () => toolSystem.register(tool),
      /уже зарегистрирован/,
      'Должна быть ошибка о дубликате'
    );
  });

  test('registerAll() добавляет несколько инструментов', () => {
    const tool1 = createTestTool({ name: 'tool1' });
    const tool2 = createTestTool({ name: 'tool2' });
    const tool3 = createTestTool({ name: 'tool3' });

    toolSystem.registerAll([tool1, tool2, tool3]);

    assert.strictEqual(toolSystem.getTools().length, 3);
    assert.ok(toolSystem.getTool('tool1'));
    assert.ok(toolSystem.getTool('tool2'));
    assert.ok(toolSystem.getTool('tool3'));
  });

  test('getTool() возвращает undefined для неизвестного инструмента', () => {
    assert.strictEqual(toolSystem.getTool('nonexistent'), undefined);
  });

  test('getTools() возвращает пустой массив если нет инструментов', () => {
    assert.deepStrictEqual(toolSystem.getTools(), []);
  });

  test('execute() успешно выполняет инструмент с валидными аргументами', async () => {
    const tool = createTestTool();
    toolSystem.register(tool);

    const result = await toolSystem.execute('test_tool', { name: 'World', count: 42 });

    assert.ok(result.includes('Hello, World!'), 'Результат должен содержать приветствие');
    assert.ok(result.includes('[OK]'), 'Результат должен содержать статус OK');
  });

  test('execute() возвращает ошибку для неизвестного инструмента', async () => {
    const result = await toolSystem.execute('nonexistent', {});

    assert.ok(result.includes('не найден'), 'Должна быть ошибка о ненайденном инструменте');
    assert.ok(result.includes('[ОШИБКА]'), 'Результат должен содержать статус ошибки');
  });

  test('execute() возвращает ошибку валидации при отсутствии обязательного поля', async () => {
    const tool = createTestTool();
    toolSystem.register(tool);

    const result = await toolSystem.execute('test_tool', { count: 42 });

    assert.ok(result.includes('отсутствует обязательное поле'), 'Должна быть ошибка валидации');
    assert.ok(result.includes('name'), 'Должна быть указана имя поля');
  });

  test('execute() возвращает ошибку при невалидном типе аргумента', async () => {
    const tool = createTestTool();
    toolSystem.register(tool);

    const result = await toolSystem.execute('test_tool', { name: 'test', count: 'not-a-number' });

    assert.ok(result.includes('должно быть типа number'), 'Должна быть ошибка типа');
  });

  test('execute() обрабатывает ошибку, выброшенную инструментом', async () => {
    const tool = createTestTool({
      execute: async () => {
        throw new Error('Внутренняя ошибка инструмента');
      },
    });
    toolSystem.register(tool);

    const result = await toolSystem.execute('test_tool', { name: 'test' });

    assert.ok(result.includes('Ошибка выполнения'), 'Должна быть обёрнутая ошибка');
    assert.ok(result.includes('Внутренняя ошибка инструмента'));
  });

  test('validateArgs() проверяет, что args — объект', () => {
    const tool = createTestTool();

    assert.strictEqual(toolSystem.validateArgs(tool, null), 'аргументы должны быть объектом');
    assert.strictEqual(toolSystem.validateArgs(tool, 'string'), 'аргументы должны быть объектом');
    assert.strictEqual(toolSystem.validateArgs(tool, 42), 'аргументы должны быть объектом');
    assert.strictEqual(toolSystem.validateArgs(tool, [1, 2, 3]), 'аргументы должны быть объектом');
  });

  test('validateArgs() проверяет обязательные поля', () => {
    const tool = createTestTool();
    const error = toolSystem.validateArgs(tool, { count: 10 });

    assert.ok(error!.includes('name'), 'Ошибка должна указывать на отсутствующее поле name');
  });

  test('validateArgs() возвращает null для валидных аргументов', () => {
    const tool = createTestTool();
    const error = toolSystem.validateArgs(tool, { name: 'test', count: 10, enabled: true });

    assert.strictEqual(error, null, 'Валидные аргументы не должны давать ошибку');
  });

  test('formatResult() добавляет статус OK', () => {
    const result = toolSystem.formatResult('test_tool', 'success output', true);

    assert.ok(result.includes('[OK]'));
    assert.ok(result.includes('success output'));
  });

  test('formatResult() добавляет статус ОШИБКА', () => {
    const result = toolSystem.formatResult('test_tool', 'error output', false);

    assert.ok(result.includes('[ОШИБКА]'));
    assert.ok(result.includes('error output'));
  });

  test('formatResult() обрезает длинный вывод', () => {
    const longOutput = 'x'.repeat(25000);
    const result = toolSystem.formatResult('test_tool', longOutput, true);

    assert.ok(result.includes('... (вывод обрезан'), 'Должен быть маркер обрезания');
    assert.ok(result.length < longOutput.length + 200, 'Результат должен быть короче исходного');
  });

  test('getToolsDescription() возвращает описание всех инструментов', () => {
    const tool1 = createTestTool({ name: 'tool1' });
    const tool2 = createTestTool({ name: 'tool2' });
    toolSystem.registerAll([tool1, tool2]);

    const description = toolSystem.getToolsDescription();

    assert.ok(description.includes('tool1'));
    assert.ok(description.includes('tool2'));
    assert.ok(description.includes('Тестовый инструмент'));
  });

  test('getToolSchemas() возвращает схемы в формате OpenAI function calling', () => {
    const tool = createTestTool();
    toolSystem.register(tool);

    const schemas = toolSystem.getToolSchemas();

    assert.strictEqual(schemas.length, 1);
    const schema = schemas[0] as any;
    assert.strictEqual(schema.type, 'function');
    assert.strictEqual(schema.function.name, 'test_tool');
    assert.ok(schema.function.parameters.properties);
  });
});