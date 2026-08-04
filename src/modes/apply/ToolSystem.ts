// Система инструментов для Apply Mode (агентного режима)
// Реестр инструментов: регистрация, выполнение, валидация, форматирование результатов

/**
 * Интерфейс инструмента — единый контракт для всех инструментов ReAct-агента.
 * Каждый инструмент описывает себя (name, description, parameters JSON Schema)
 * и умеет выполнять действие (execute).
 */
export interface Tool {
  /** Уникальное имя инструмента (например, 'read_file') */
  name: string;
  /** Человекочитаемое описание — передаётся LLM в system prompt */
  description: string;
  /** JSON Schema параметров для function calling API */
  parameters: Record<string, unknown>;
  /** Функция выполнения: принимает аргументы, возвращает строковый результат */
  execute(args: unknown): Promise<string>;
}

/**
 * Результат выполнения инструмента.
 */
export interface ToolResult {
  /** Имя инструмента */
  tool: string;
  /** Строковый результат (текст файла, вывод команды и т.п.) */
  output: string;
  /** Успешно ли выполнение */
  ok: boolean;
}

/**
 * ToolSystem — реестр инструментов агента.
 *
 * Отвечает за:
 * - register / registerAll — регистрацию инструментов
 * - execute — выполнение инструмента с валидацией аргументов по JSON Schema
 * - formatResult — форматирование результата для передачи LLM (observation)
 * - getToolsDescription / getToolSchemas — описание инструментов для system prompt
 */
export class ToolSystem {
  /** Реестр инструментов: имя → Tool */
  private readonly tools = new Map<string, Tool>();

  /**
   * Зарегистрировать один инструмент.
   * @throws если инструмент с таким именем уже зарегистрирован
   */
  register(tool: Tool): void {
    if (this.tools.has(tool.name)) {
      throw new Error(`Инструмент '${tool.name}' уже зарегистрирован`);
    }
    this.tools.set(tool.name, tool);
  }

  /**
   * Зарегистрировать список инструментов.
   */
  registerAll(tools: Tool[]): void {
    for (const tool of tools) {
      this.register(tool);
    }
  }

  /**
   * Получить инструмент по имени.
   */
  getTool(name: string): Tool | undefined {
    return this.tools.get(name);
  }

  /**
   * Получить список всех зарегистрированных инструментов.
   */
  getTools(): Tool[] {
    return Array.from(this.tools.values());
  }

  /**
   * Выполнить инструмент по имени с валидацией аргументов.
   * @param name — имя инструмента
   * @param args — аргументы (объект)
   * @returns отформатированный результат (см. formatResult)
   */
  async execute(name: string, args: unknown): Promise<string> {
    const tool = this.tools.get(name);
    if (!tool) {
      return this.formatResult(name, `Ошибка: инструмент '${name}' не найден`, false);
    }

    // Валидация аргументов по JSON Schema
    const validationError = this.validateArgs(tool, args);
    if (validationError) {
      return this.formatResult(name, `Ошибка валидации аргументов: ${validationError}`, false);
    }

    try {
      // Выполняем инструмент и форматируем результат
      const output = await tool.execute(args);
      return this.formatResult(name, output, true);
    } catch (err) {
      // Любая ошибка инструмента превращается в строку для LLM,
      // чтобы агент мог попробовать другой подход (по правилам ReAct)
      const message = err instanceof Error ? err.message : String(err);
      return this.formatResult(name, `Ошибка выполнения: ${message}`, false);
    }
  }

  /**
   * Валидация аргументов по JSON Schema инструмента.
   * Проверяет обязательные поля и типы переданных значений.
   * @param tool — инструмент
   * @param args — переданные аргументы
   * @returns текст ошибки или null, если аргументы валидны
   */
  validateArgs(tool: Tool, args: unknown): string | null {
    if (typeof args !== 'object' || args === null || Array.isArray(args)) {
      return 'аргументы должны быть объектом';
    }

    const schema = tool.parameters as {
      type?: string;
      properties?: Record<string, { type?: string }>;
      required?: string[];
    };

    const record = args as Record<string, unknown>;
    const required = schema.required ?? [];

    // Проверяем обязательные поля
    for (const field of required) {
      if (record[field] === undefined) {
        return `отсутствует обязательное поле '${field}'`;
      }
    }

    // Проверяем типы переданных полей
    const properties = schema.properties ?? {};
    for (const [key, value] of Object.entries(record)) {
      if (value === undefined) continue;
      const propSchema = properties[key];
      if (!propSchema?.type) continue;

      const expected = propSchema.type;
      const actual = typeof value;
      const valid =
        (expected === 'string' && actual === 'string') ||
        (expected === 'number' && actual === 'number') ||
        (expected === 'boolean' && actual === 'boolean') ||
        (expected === 'object' && actual === 'object' && value !== null) ||
        (expected === 'array' && Array.isArray(value));
      if (!valid) {
        return `поле '${key}' должно быть типа ${expected}, получено ${actual}`;
      }
    }

    return null;
  }

  /**
   * Форматирование результата инструмента для передачи LLM (observation в ReAct-цикле).
   * Добавляет заголовок с именем инструмента и обрезает слишком длинные выводы,
   * чтобы не раздувать контекст.
   * @param name — имя инструмента
   * @param output — сырой результат
   * @param ok — успешно ли выполнение
   */
  formatResult(name: string, output: string, ok = true): string {
    // Ограничение длины вывода (защита контекста LLM)
    const MAX_LENGTH = 20000;
    let text = output;
    if (text.length > MAX_LENGTH) {
      text = text.slice(0, MAX_LENGTH) + `\n... (вывод обрезан: ${output.length} символов)`;
    }
    const status = ok ? 'OK' : 'ОШИБКА';
    return `=== Результат инструмента: ${name} [${status}] ===\n${text}`;
  }

  /**
   * Сформировать текстовое описание всех инструментов для system prompt.
   * Включает имя, описание и JSON Schema параметров.
   */
  getToolsDescription(): string {
    const lines: string[] = [];
    for (const tool of this.tools.values()) {
      lines.push(`- ${tool.name}: ${tool.description}`);
      lines.push(`  Параметры (JSON Schema): ${JSON.stringify(tool.parameters, null, 2)}`);
    }
    return lines.join('\n');
  }

  /**
   * Получить массив схем инструментов в формате OpenAI function calling API.
   * Может использоваться при отправке запроса с tools: [...] в body.
   */
  getToolSchemas(): Array<Record<string, unknown>> {
    return Array.from(this.tools.values()).map((tool) => ({
      type: 'function',
      function: {
        name: tool.name,
        description: tool.description,
        parameters: tool.parameters,
      },
    }));
  }
}