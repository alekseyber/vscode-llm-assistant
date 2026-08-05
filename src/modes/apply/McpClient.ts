// MCP-клиент — обёртка вокруг @modelcontextprotocol/sdk (слой 05 Common Interfaces)
// Подключается к MCP-серверам по stdio, получает список инструментов,
// выполняет их и преобразует в формат Tool (ToolSystem).
//
// Архитектура:
//   McpClient        — один клиент на один MCP-сервер
//   McpManager       — управляет несколькими McpClient'ами, загружает конфиг из VS Code

import * as path from 'path';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import type { Tool } from './ToolSystem';

/**
 * Конфигурация одного MCP-сервера (из настроек VS Code).
 * Соответствует формату StdioServerParameters из SDK.
 */
export interface McpServerConfig {
  /** Уникальное имя сервера (используется как префикс для имён инструментов) */
  name: string;
  /** Исполняемый файл (например 'npx', 'node', 'python') */
  command: string;
  /** Аргументы командной строки */
  args?: string[];
  /** Переменные окружения для процесса сервера */
  env?: Record<string, string>;
}

/**
 * Результат подключения к MCP-серверу:
 * список инструментов в формате ToolSystem.
 */
export interface McpConnectResult {
  /** Имя сервера */
  serverName: string;
  /** Инструменты, предоставленные сервером */
  tools: Tool[];
}

/**
 * McpClient — обёртка над Client из @modelcontextprotocol/sdk.
 *
 * Управляет жизненным циклом одного MCP-сервера:
 * 1. connect() — запускает процесс сервера, устанавливает связь
 * 2. listTools() — получает список инструментов в формате Tool[]
 * 3. executeTool() — вызывает инструмент сервера
 * 4. disconnect() — завершает процесс сервера
 */
export class McpClient {
  /** Конфигурация сервера */
  private readonly config: McpServerConfig;
  /** SDK-клиент MCP (инициализируется в connect) */
  private client: Client | null = null;
  /** Транспорт (stdio) */
  private transport: StdioClientTransport | null = null;
  /** Подключён ли клиент */
  private connected = false;

  constructor(config: McpServerConfig) {
    this.config = config;
  }

  /**
   * Подключиться к MCP-серверу.
   *
   * Создаёт дочерний процесс (command + args), обменивается handshake'ом
   * и инициализирует клиент MCP. В случае ошибки выбрасывает исключение.
   *
   * @returns результат подключения: имя сервера + список инструментов
   */
  async connect(): Promise<McpConnectResult> {
    // Создаём транспорт через stdio (дочерний процесс)
    this.transport = new StdioClientTransport({
      command: this.config.command,
      args: this.config.args,
      env: this.config.env,
    });

    this.client = new Client(
      { name: 'vscode-llm-assistant', version: '0.5.3' },
      { capabilities: {} },
    );

    // Подключаем клиент к транспорту (запускает процесс и handshake)
    await this.client.connect(this.transport);
    this.connected = true;

    // Получаем инструменты сервера и преобразуем в формат ToolSystem
    const tools = await this.listTools();

    return {
      serverName: this.config.name,
      tools,
    };
  }

  /**
   * Получить список инструментов MCP-сервера в формате Tool[].
   *
   * Вызывает `tools/list` через SDK, преобразует inputSchema
   * в JSON Schema (parameters) и оборачивает execute.
   *
   * @returns массив инструментов в формате ToolSystem
   */
  async listTools(): Promise<Tool[]> {
    if (!this.client) {
      throw new Error(`MCP-клиент '${this.config.name}' не подключён`);
    }

    const result = await this.client.listTools();

    return result.tools.map((mcpTool) => ({
      name: `mcp_${this.config.name}_${mcpTool.name}`,
      description: mcpTool.description ?? `MCP-инструмент: ${mcpTool.name}`,
      parameters: mcpTool.inputSchema as Record<string, unknown>,
      execute: async (args: unknown) => {
        return this.executeTool(mcpTool.name, args as Record<string, unknown>);
      },
    }));
  }

  /**
   * Выполнить инструмент MCP-сервера.
   *
   * Вызывает `tools/call` через SDK, извлекает текстовое содержимое
   * из результата (объединяет все text-блоки).
   *
   * @param name — имя инструмента на сервере (без префикса mcp_*)
   * @param args — аргументы инструмента
   * @returns строковый результат выполнения
   */
  async executeTool(name: string, args: Record<string, unknown>): Promise<string> {
    if (!this.client) {
      throw new Error(`MCP-клиент '${this.config.name}' не подключён`);
    }

    const result = await this.client.callTool({ name, arguments: args });

    // Извлекаем текстовое содержимое из блоков результата
    const content = result.content as Array<{ type: string; text?: string }>;
    const textParts: string[] = [];
    for (const block of content) {
      if (block.type === 'text' && block.text) {
        textParts.push(block.text);
      }
    }

    if (textParts.length === 0) {
      return '(инструмент не вернул текстового результата)';
    }

    return textParts.join('\n');
  }

  /**
   * Отключиться от MCP-сервера.
   *
   * Закрывает транспорт (завершает дочерний процесс),
   * освобождает ресурсы клиента.
   */
  disconnect(): void {
    this.connected = false;
    if (this.transport) {
      // close() — асинхронный, но мы вызываем его без await,
      // так как нам не нужен результат закрытия
      this.transport.close().catch(() => {
        // Игнорируем ошибки закрытия — процесс может уже завершиться
      });
      this.transport = null;
    }
    this.client = null;
  }

  /**
   * Подключён ли клиент к серверу.
   */
  get isConnected(): boolean {
    return this.connected;
  }

  /**
   * Имя сервера из конфигурации.
   */
  get serverName(): string {
    return this.config.name;
  }
}

/**
 * Загрузить конфигурацию MCP-серверов из настроек VS Code.
 *
 * Читает `llmAssistant.mcp.servers` — массив объектов:
 *   [{ name: "...", command: "...", args: [...], env: {...} }]
 *
 * @returns массив конфигов серверов
 */
export function loadMcpConfig(): McpServerConfig[] {
  // Динамический импорт vscode чтобы не ломать юнит-тесты без VS Code API
  try {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const vscode = require('vscode');
    const config = vscode.workspace.getConfiguration('llmAssistant');
    const servers: McpServerConfig[] = config.get('mcp.servers', []);
    return servers;
  } catch {
    // Если VS Code API недоступен (юнит-тесты) — возвращаем пустой список
    return [];
  }
}
